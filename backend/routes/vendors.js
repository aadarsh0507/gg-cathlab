const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const pool = require('../db/mysql');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);

router.get('/', requirePermission('vendors', 'view'), async (req, res) => {
  const { activeOnly } = req.query;
  let sql = 'SELECT * FROM vendors';
  if (activeOnly === 'true') sql += ' WHERE is_active = 1';
  sql += ' ORDER BY name ASC';
  try {
    const [rows] = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    console.error('List vendors error:', err.message);
    res.status(500).json({ error: 'Failed to fetch vendors.' });
  }
});

router.post('/bulk-import', requirePermission('vendors', 'create'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch {
    return res.status(400).json({ error: 'Could not parse file. Please upload a valid Excel file.' });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rawRows.length === 0) {
    return res.status(400).json({ error: 'The Excel sheet is empty.' });
  }

  const results = { inserted: 0, skipped: 0, errors: [] };
  const names = [];

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    // Accept any column whose header contains "name" (case-insensitive), or first column
    const key = Object.keys(row).find((k) => k.trim().toLowerCase().includes('name')) || Object.keys(row)[0];
    const name = String(row[key] || '').trim();
    if (!name) {
      results.errors.push({ row: i + 2, reason: 'Name is empty.' });
      continue;
    }
    names.push({ rowNum: i + 2, name });
  }

  if (names.length === 0) {
    return res.status(400).json({ error: 'No valid vendor names found in the file.' });
  }

  try {
    // Load all existing vendor names in one query
    const [existing] = await pool.query('SELECT LOWER(name) AS n FROM vendors');
    const existingSet = new Set(existing.map((r) => r.n));

    const toInsert = [];
    const seenInFile = new Set();

    for (const { rowNum, name } of names) {
      const key = name.toLowerCase();
      if (existingSet.has(key) || seenInFile.has(key)) {
        results.skipped++;
        continue;
      }
      seenInFile.add(key);
      toInsert.push(name);
    }

    // Batch insert in chunks of 500
    const CHUNK = 500;
    for (let c = 0; c < toInsert.length; c += CHUNK) {
      const chunk = toInsert.slice(c, c + CHUNK);
      const placeholders = chunk.map(() => '(?, 1)').join(',');
      await pool.query(`INSERT INTO vendors (name, is_active) VALUES ${placeholders}`, chunk);
      results.inserted += chunk.length;
    }

    res.json(results);
  } catch (err) {
    console.error('Vendor bulk import error:', err.message);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

router.post('/', requirePermission('vendors', 'create'), async (req, res) => {
  const { name, is_active } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required.' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO vendors (name, is_active) VALUES (?, ?)',
      [name.trim(), is_active === undefined ? 1 : is_active ? 1 : 0]
    );
    const [rows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `A vendor named '${name}' already exists.` });
    }
    console.error('Create vendor error:', err.message);
    res.status(500).json({ error: 'Failed to create vendor.' });
  }
});

router.put('/:id', requirePermission('vendors', 'edit'), async (req, res) => {
  const { name, is_active } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required.' });
  }
  try {
    const [beforeRows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
    if (beforeRows.length === 0) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }
    req.auditBefore = beforeRows[0];

    const [result] = await pool.query(
      'UPDATE vendors SET name = ?, is_active = ? WHERE id = ?',
      [name.trim(), is_active ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }
    const [rows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `A vendor named '${name}' already exists.` });
    }
    console.error('Update vendor error:', err.message);
    res.status(500).json({ error: 'Failed to update vendor.' });
  }
});

router.delete('/:id', requirePermission('vendors', 'delete'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }

    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM invoice_vendor_documents WHERE vendor_id = ?',
      [req.params.id]
    );
    if (count > 0) {
      return res.status(409).json({
        error: `Cannot delete '${rows[0].name}' — ${count} document(s) use this vendor.`,
      });
    }

    req.auditBefore = rows[0];
    await pool.query('DELETE FROM vendors WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error('Delete vendor error:', err.message);
    res.status(500).json({ error: 'Failed to delete vendor.' });
  }
});

module.exports = router;
