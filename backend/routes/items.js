const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const pool = require('../db/mysql');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(requireAuth);

const SELECT_WITH_JOINS = `
  SELECT items.*, categories.name AS category_name, units.name AS unit_name
  FROM items
  LEFT JOIN categories ON categories.id = items.category_id
  LEFT JOIN units ON units.id = items.unit_id
`;

async function generateItemCode(conn) {
  await conn.query(
    'INSERT INTO item_sequences (id, last_seq) VALUES (1, 0) ON DUPLICATE KEY UPDATE id = id'
  );

  await conn.query('SELECT last_seq FROM item_sequences WHERE id = 1 FOR UPDATE');

  await conn.query('UPDATE item_sequences SET last_seq = last_seq + 1 WHERE id = 1');

  const [seqRows] = await conn.query('SELECT last_seq FROM item_sequences WHERE id = 1');
  const seq = seqRows[0].last_seq;

  return `IMP-${String(seq).padStart(3, '0')}`;
}

async function findDuplicateItemName(conn, itemName, excludeId) {
  let sql = 'SELECT id, item_code FROM items WHERE LOWER(item_name) = LOWER(?)';
  const params = [itemName];
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  const [rows] = await conn.query(sql, params);
  return rows[0] || null;
}

async function categoryExists(conn, categoryId) {
  const [rows] = await conn.query('SELECT id FROM categories WHERE id = ?', [categoryId]);
  return rows.length > 0;
}

async function unitExists(conn, unitId) {
  const [rows] = await conn.query('SELECT id FROM units WHERE id = ?', [unitId]);
  return rows.length > 0;
}

router.get('/', requirePermission('items', 'view'), async (req, res) => {
  const { search, activeOnly } = req.query;

  // Unpaginated callers (item-picker dropdowns on the invoice form, etc.)
  // pass paginate=false and rely on activeOnly=true to keep the payload
  // reasonable; everything else (Item Master screen) paginates server-side.
  const paginate = req.query.paginate !== 'false';

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
  const offset = (page - 1) * pageSize;

  let where = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ' AND (items.item_code LIKE ? OR items.item_name LIKE ? OR items.short_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (activeOnly === 'true') {
    where += ' AND items.is_active = 1';
  }

  try {
    if (!paginate) {
      const [rows] = await pool.query(`${SELECT_WITH_JOINS} ${where} ORDER BY items.item_name ASC`, params);
      return res.json(rows);
    }

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM items ${where}`, params);
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `${SELECT_WITH_JOINS} ${where} ORDER BY items.item_name ASC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({ data: rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 });
  } catch (err) {
    console.error('List items error:', err.message);
    res.status(500).json({ error: 'Failed to fetch items.' });
  }
});

router.get('/:id', requirePermission('items', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query(`${SELECT_WITH_JOINS} WHERE items.id = ?`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Get item error:', err.message);
    res.status(500).json({ error: 'Failed to fetch item.' });
  }
});

router.post('/', requirePermission('items', 'create'), async (req, res) => {
  const { item_name, short_name, category_id, purchase_cost, mrp, unit_id, is_active } = req.body || {};

  if (!item_name) {
    return res.status(400).json({ error: 'item_name is required.' });
  }

  if (!category_id) {
    return res.status(400).json({ error: 'category_id is required.' });
  }

  if (!unit_id) {
    return res.status(400).json({ error: 'unit_id is required.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (!(await categoryExists(conn, category_id))) {
      await conn.rollback();
      return res.status(400).json({ error: 'Selected category does not exist.' });
    }

    if (!(await unitExists(conn, unit_id))) {
      await conn.rollback();
      return res.status(400).json({ error: 'Selected unit does not exist.' });
    }

    const duplicate = await findDuplicateItemName(conn, item_name);
    if (duplicate) {
      await conn.rollback();
      return res.status(409).json({
        error: `An item named '${item_name}' already exists (code ${duplicate.item_code}).`,
      });
    }

    const itemCode = await generateItemCode(conn);

    const [result] = await conn.query(
      `INSERT INTO items (item_code, item_name, short_name, category_id, purchase_cost, mrp, unit_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemCode,
        item_name,
        short_name || null,
        category_id,
        purchase_cost === undefined || purchase_cost === '' ? null : purchase_cost,
        mrp || 0,
        unit_id,
        is_active === undefined ? 1 : is_active ? 1 : 0,
      ]
    );

    const [rows] = await conn.query(`${SELECT_WITH_JOINS} WHERE items.id = ?`, [result.insertId]);

    await conn.commit();

    res.status(201).json(rows[0]);
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // Rollback can fail if the connection is already broken; the original error is what matters.
    }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `An item named '${item_name}' already exists.` });
    }
    console.error('Create item error:', err.message);
    res.status(500).json({ error: 'Failed to create item.' });
  } finally {
    conn.release();
  }
});

router.put('/:id', requirePermission('items', 'edit'), async (req, res) => {
  const { item_name, short_name, category_id, purchase_cost, mrp, unit_id, is_active } = req.body || {};

  if (!item_name) {
    return res.status(400).json({ error: 'item_name is required.' });
  }

  if (!category_id) {
    return res.status(400).json({ error: 'category_id is required.' });
  }

  if (!unit_id) {
    return res.status(400).json({ error: 'unit_id is required.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (!(await categoryExists(conn, category_id))) {
      await conn.rollback();
      return res.status(400).json({ error: 'Selected category does not exist.' });
    }

    if (!(await unitExists(conn, unit_id))) {
      await conn.rollback();
      return res.status(400).json({ error: 'Selected unit does not exist.' });
    }

    const duplicate = await findDuplicateItemName(conn, item_name, req.params.id);
    if (duplicate) {
      await conn.rollback();
      return res.status(409).json({
        error: `An item named '${item_name}' already exists (code ${duplicate.item_code}).`,
      });
    }

    const [beforeRows] = await conn.query(`${SELECT_WITH_JOINS} WHERE items.id = ?`, [req.params.id]);
    req.auditBefore = beforeRows[0];
    req.auditIgnoreFields = ['category_name', 'unit_name'];

    const [result] = await conn.query(
      `UPDATE items SET item_name = ?, short_name = ?, category_id = ?, purchase_cost = ?, mrp = ?, unit_id = ?, is_active = ?
       WHERE id = ?`,
      [
        item_name,
        short_name || null,
        category_id,
        purchase_cost === undefined || purchase_cost === '' ? null : purchase_cost,
        mrp || 0,
        unit_id,
        is_active ? 1 : 0,
        req.params.id,
      ]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Item not found.' });
    }

    const [rows] = await conn.query(`${SELECT_WITH_JOINS} WHERE items.id = ?`, [req.params.id]);

    await conn.commit();

    res.json(rows[0]);
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // Rollback can fail if the connection is already broken; the original error is what matters.
    }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `An item named '${item_name}' already exists.` });
    }
    console.error('Update item error:', err.message);
    res.status(500).json({ error: 'Failed to update item.' });
  } finally {
    conn.release();
  }
});

const IMPORT_CHUNK_SIZE = 500;

router.post('/bulk-import', requirePermission('items', 'create'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch {
    return res.status(400).json({ error: 'Could not parse the uploaded file. Please upload a valid Excel file.' });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rawRows.length === 0) {
    return res.status(400).json({ error: 'The Excel sheet is empty.' });
  }

  const normaliseRow = (row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k.trim().toLowerCase()] = typeof v === 'string' ? v.trim() : v;
    }
    return out;
  };

  // ── Pass 1: parse all rows in JS, collect unique category/unit names ──────
  const results = { inserted: 0, skipped: 0, errors: [] };
  const parsed = [];
  const uniqueCategories = new Set();
  const uniqueUnits = new Set();

  for (let i = 0; i < rawRows.length; i++) {
    const row = normaliseRow(rawRows[i]);
    const rowNum = i + 2;
    const itemName = String(row['item'] || '').trim();

    if (!itemName) {
      results.errors.push({ row: rowNum, reason: 'Item name is empty.' });
      continue;
    }

    const categoryName = String(row['category'] || '').trim();
    const groupName = String(row['group'] || '').trim();

    if (!categoryName) {
      results.errors.push({ row: rowNum, item: itemName, reason: 'Category is empty.' });
      continue;
    }
    if (!groupName) {
      results.errors.push({ row: rowNum, item: itemName, reason: 'Group/Unit is empty.' });
      continue;
    }

    const shortName = String(row['short.name'] || '').trim() || null;
    const purchaseCost = row['p.rate'] !== '' ? parseFloat(row['p.rate']) : null;
    const mrp = row['org.mrp'] !== '' ? parseFloat(row['org.mrp']) : 0;

    uniqueCategories.add(categoryName);
    uniqueUnits.add(groupName);
    parsed.push({ rowNum, itemName, itemNameLower: itemName.toLowerCase(), shortName, categoryName, groupName, purchaseCost, mrp });
  }

  const conn = await pool.getConnection();
  try {
    // ── Pass 2: load all existing item names in one query ─────────────────
    const [existingRows] = await conn.query('SELECT LOWER(item_name) AS n FROM items');
    const existingNames = new Set(existingRows.map((r) => r.n));

    // ── Pass 3: resolve/create categories in bulk ─────────────────────────
    const categoryCache = {};
    if (uniqueCategories.size > 0) {
      const catNames = [...uniqueCategories];
      const placeholders = catNames.map(() => 'LOWER(?) ').join(', ');
      const [catRows] = await conn.query(
        `SELECT id, LOWER(name) AS n FROM categories WHERE LOWER(name) IN (${catNames.map(() => '?').join(',')})`,
        catNames
      );
      for (const r of catRows) categoryCache[r.n] = r.id;

      for (const name of catNames) {
        const key = name.toLowerCase();
        if (categoryCache[key] === undefined) {
          const [r] = await conn.query('INSERT INTO categories (name, is_active) VALUES (?, 1)', [name]);
          categoryCache[key] = r.insertId;
        }
      }
    }

    // ── Pass 4: resolve/create units in bulk ──────────────────────────────
    const unitCache = {};
    if (uniqueUnits.size > 0) {
      const unitNames = [...uniqueUnits];
      const [unitRows] = await conn.query(
        `SELECT id, LOWER(name) AS n FROM units WHERE LOWER(name) IN (${unitNames.map(() => '?').join(',')})`,
        unitNames
      );
      for (const r of unitRows) unitCache[r.n] = r.id;

      for (const name of unitNames) {
        const key = name.toLowerCase();
        if (unitCache[key] === undefined) {
          const [r] = await conn.query('INSERT INTO units (name, is_active) VALUES (?, 1)', [name]);
          unitCache[key] = r.insertId;
        }
      }
    }

    // ── Pass 5: build the final insert list, dedup against existing ───────
    const toInsert = [];
    const seenInFile = new Set();

    for (const p of parsed) {
      if (existingNames.has(p.itemNameLower) || seenInFile.has(p.itemNameLower)) {
        results.skipped++;
        continue;
      }
      seenInFile.add(p.itemNameLower);
      toInsert.push(p);
    }

    // ── Pass 6: allocate a contiguous block of sequence numbers ───────────
    if (toInsert.length > 0) {
      await conn.beginTransaction();
      try {
        await conn.query(
          'INSERT INTO item_sequences (id, last_seq) VALUES (1, 0) ON DUPLICATE KEY UPDATE id = id'
        );
        await conn.query('SELECT last_seq FROM item_sequences WHERE id = 1 FOR UPDATE');
        const [seqRow] = await conn.query('SELECT last_seq FROM item_sequences WHERE id = 1');
        const startSeq = seqRow[0].last_seq + 1;
        const endSeq = startSeq + toInsert.length - 1;
        await conn.query('UPDATE item_sequences SET last_seq = ? WHERE id = 1', [endSeq]);

        // ── Pass 7: chunk-insert 500 rows at a time ───────────────────────
        for (let c = 0; c < toInsert.length; c += IMPORT_CHUNK_SIZE) {
          const chunk = toInsert.slice(c, c + IMPORT_CHUNK_SIZE);
          const values = [];
          const placeholders = chunk.map((p, idx) => {
            const seq = startSeq + c + idx;
            const itemCode = `IMP-${String(seq).padStart(3, '0')}`;
            const pc = p.purchaseCost === null || isNaN(p.purchaseCost) ? null : p.purchaseCost;
            const mrp = isNaN(p.mrp) ? 0 : p.mrp;
            values.push(itemCode, p.itemName, p.shortName, categoryCache[p.categoryName.toLowerCase()], pc, mrp, unitCache[p.groupName.toLowerCase()]);
            return '(?, ?, ?, ?, ?, ?, ?, 1)';
          });

          await conn.query(
            `INSERT INTO items (item_code, item_name, short_name, category_id, purchase_cost, mrp, unit_id, is_active) VALUES ${placeholders.join(',')}`,
            values
          );
          results.inserted += chunk.length;
        }

        await conn.commit();
      } catch (err) {
        try { await conn.rollback(); } catch { /* ignore */ }
        throw err;
      }
    }

    res.json(results);
  } catch (err) {
    console.error('Bulk import error:', err.message);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  } finally {
    conn.release();
  }
});

router.delete('/:id', requirePermission('items', 'delete'), async (req, res) => {
  try {
    const [beforeRows] = await pool.query(`${SELECT_WITH_JOINS} WHERE items.id = ?`, [req.params.id]);
    if (beforeRows.length === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }
    req.auditBefore = beforeRows[0];
    req.auditIgnoreFields = ['category_name', 'unit_name'];

    const [result] = await pool.query('DELETE FROM items WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }
    res.status(204).send();
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({
        error: 'This item is used on existing invoices and cannot be deleted. Consider marking it inactive instead.',
      });
    }
    console.error('Delete item error:', err.message);
    res.status(500).json({ error: 'Failed to delete item.' });
  }
});

module.exports = router;
