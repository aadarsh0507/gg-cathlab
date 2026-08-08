const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db/mysql');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { vendorDocumentUpload } = require('../middleware/vendorDocumentUpload');
const { moveToNas, deleteFromNas, nasFileExists, nasFilePath } = require('../utils/nasStorage');

const router = express.Router();

router.use(requireAuth);

const PAYMENT_MODES = ['Credit', 'Cash', 'Card', 'UPI', 'Insurance', 'Cheque'];

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function nextInvoiceNumber(conn, year) {
  // Ensure row exists
  await conn.query(
    'INSERT INTO invoice_sequences (invoice_year, last_seq) VALUES (?, 0) ON DUPLICATE KEY UPDATE invoice_year = invoice_year',
    [year]
  );

  // Lock the sequence row
  await conn.query('SELECT last_seq FROM invoice_sequences WHERE invoice_year = ? FOR UPDATE', [year]);

  // Sync with actual max invoice number in case rows were manually deleted/inserted.
  // This prevents gaps from causing duplicate or stale sequence numbers.
  const [maxRows] = await conn.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(invoice_no, '-', -1) AS UNSIGNED)), 0) AS max_seq
     FROM invoices
     WHERE invoice_year = ?`,
    [year]
  );
  const maxActual = maxRows[0].max_seq || 0;

  // Sync the sequence table to the actual max invoice number.
  // GREATEST handles the case where the sequence fell behind (e.g. manual inserts).
  // We also allow it to reset downward when invoices were manually deleted,
  // so the next number follows directly after the last real invoice.
  await conn.query(
    'UPDATE invoice_sequences SET last_seq = ? WHERE invoice_year = ?',
    [maxActual, year]
  );

  // Now increment by 1
  await conn.query(
    'UPDATE invoice_sequences SET last_seq = last_seq + 1 WHERE invoice_year = ?',
    [year]
  );

  const [seqRows] = await conn.query('SELECT last_seq FROM invoice_sequences WHERE invoice_year = ?', [year]);
  const seq = seqRows[0].last_seq;

  return `IMP-${year}-${String(seq).padStart(6, '0')}`;
}

// Recomputes every line + invoice total server-side from item mrp looked up in
// the DB; client-supplied prices/totals are never trusted.
async function computeInvoiceTotals(conn, items, discountPercent) {
  if (!Array.isArray(items) || items.length === 0) {
    throw { status: 400, message: 'At least one line item is required.' };
  }

  const itemIds = items.map((i) => i.item_id).filter((id) => id !== undefined && id !== null);
  let dbItems = [];
  if (itemIds.length > 0) {
    const [rows] = await conn.query(
      `SELECT id, item_name, mrp FROM items WHERE id IN (${itemIds.map(() => '?').join(',')})`,
      itemIds
    );
    dbItems = rows;
  }
  const dbItemMap = new Map(dbItems.map((i) => [i.id, i]));

  let subtotal = 0;
  const computedLines = [];

  for (const line of items) {
    const quantity = Number(line.quantity);
    if (!quantity || quantity <= 0) {
      throw { status: 400, message: 'Each line item must have a quantity greater than zero.' };
    }

    let itemName, mrp;

    if (line.item_id && dbItemMap.has(line.item_id)) {
      const dbItem = dbItemMap.get(line.item_id);
      itemName = dbItem.item_name;
      // Use client-supplied MRP if provided, otherwise fall back to master price.
      mrp = line.mrp !== undefined && line.mrp !== null ? Number(line.mrp) : Number(dbItem.mrp);
    } else {
      // Allow ad-hoc lines not tied to an item master row, but require explicit values.
      if (!line.item_name || line.mrp === undefined) {
        throw { status: 400, message: 'Line items must reference a valid item_id or supply item_name and mrp.' };
      }
      itemName = line.item_name;
      mrp = Number(line.mrp);
    }

    const lineSubtotal = round2(quantity * mrp);
    subtotal += lineSubtotal;

    computedLines.push({
      item_id: line.item_id || null,
      item_name: itemName,
      batch_no: line.batch_no || null,
      expiry_date: line.expiry_date || null,
      quantity,
      mrp,
      lineSubtotal,
    });
  }

  subtotal = round2(subtotal);
  const discountPct = round2(Number(discountPercent) || 0);
  const discountAmount = round2((subtotal * discountPct) / 100);

  const finalLines = computedLines.map((line) => {
    const lineShare = subtotal > 0 ? line.lineSubtotal / subtotal : 0;
    const lineDiscount = round2(discountAmount * lineShare);
    const lineTotal = round2(line.lineSubtotal - lineDiscount);

    return {
      ...line,
      line_total: lineTotal,
    };
  });

  const totalAmount = round2(subtotal - discountAmount);

  return {
    lines: finalLines,
    subtotal,
    discountPercent: discountPct,
    discountAmount,
    totalAmount,
  };
}

// Seeds one invoice_approvals row per active approval level, so the invoice
// enters the approval chain at whatever levels are currently configured. If
// no levels exist, there's nothing to approve — the invoice is auto-approved
// rather than stuck pending forever with no way to clear it.
async function seedInvoiceApprovals(conn, invoiceId) {
  const [levels] = await conn.query('SELECT id FROM approval_levels WHERE is_active = 1 ORDER BY sequence_order ASC');

  if (levels.length === 0) {
    await conn.query('UPDATE invoices SET approval_status = ? WHERE id = ?', ['approved', invoiceId]);
    return;
  }

  for (const level of levels) {
    await conn.query('INSERT INTO invoice_approvals (invoice_id, approval_level_id, status) VALUES (?, ?, ?)', [
      invoiceId,
      level.id,
      'pending',
    ]);
  }
}

router.post('/', requirePermission('invoices', 'create'), async (req, res) => {
  const {
    patient_uhid,
    patient_name,
    patient_age,
    patient_gender,
    patient_mobile,
    patient_address,
    doctor_name,
    department,
    payment_mode,
    invoice_date,
    bill_date,
    discount_percent,
    items,
  } = req.body || {};

  if (!patient_name) {
    return res.status(400).json({ error: 'patient_name is required.' });
  }

  const paymentMode = payment_mode || 'Credit';
  if (!PAYMENT_MODES.includes(paymentMode)) {
    return res.status(400).json({ error: `payment_mode must be one of: ${PAYMENT_MODES.join(', ')}.` });
  }

  const invoiceDate = invoice_date ? new Date(invoice_date) : new Date();
  if (Number.isNaN(invoiceDate.getTime())) {
    return res.status(400).json({ error: 'invoice_date is invalid.' });
  }
  const year = invoiceDate.getFullYear();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const totals = await computeInvoiceTotals(conn, items, discount_percent);
    const invoiceNo = await nextInvoiceNumber(conn, year);

    const [invoiceResult] = await conn.query(
      `INSERT INTO invoices
        (invoice_no, invoice_year, patient_uhid, patient_name, patient_age, patient_gender, patient_mobile,
         patient_address, doctor_name, department, payment_mode, invoice_date, bill_date, subtotal, discount_percent,
         discount_amount, total_amount, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'finalized', ?)`,
      [
        invoiceNo,
        year,
        patient_uhid,
        patient_name,
        patient_age || null,
        patient_gender || null,
        patient_mobile || null,
        patient_address || null,
        doctor_name || null,
        department || null,
        paymentMode,
        invoiceDate.toISOString().slice(0, 10),
        bill_date || null,
        totals.subtotal,
        totals.discountPercent,
        totals.discountAmount,
        totals.totalAmount,
        req.user.id,
      ]
    );

    const invoiceId = invoiceResult.insertId;

    for (const line of totals.lines) {
      await conn.query(
        `INSERT INTO invoice_items
          (invoice_id, item_id, item_name, batch_no, expiry_date, quantity, mrp, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          line.item_id,
          line.item_name,
          line.batch_no,
          line.expiry_date,
          line.quantity,
          line.mrp,
          line.line_total,
        ]
      );
    }

    await seedInvoiceApprovals(conn, invoiceId);

    await conn.commit();

    res.status(201).json({ id: invoiceId, invoice_no: invoiceNo, ...totals });
  } catch (err) {
    await conn.rollback();
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Create invoice error:', err.message);
    res.status(500).json({ error: 'Failed to create invoice.' });
  } finally {
    conn.release();
  }
});

// Non-financial edit only: patient/doctor/department/payment/insurance fields.
// Line items, quantities, discount, and totals are locked once an invoice is
// created — changing those would require re-running server-side total
// recomputation and touches billing/audit concerns, so it's deliberately out
// of scope here.
router.put('/:id', requirePermission('invoices', 'edit'), async (req, res) => {
  const {
    patient_uhid,
    patient_name,
    patient_age,
    patient_gender,
    patient_mobile,
    patient_address,
    doctor_name,
    department,
    payment_mode,
    invoice_date,
    bill_date,
  } = req.body || {};

  if (!patient_uhid || !patient_name) {
    return res.status(400).json({ error: 'patient_uhid and patient_name are required.' });
  }

  const paymentMode = payment_mode || 'Cash';
  if (!PAYMENT_MODES.includes(paymentMode)) {
    return res.status(400).json({ error: `payment_mode must be one of: ${PAYMENT_MODES.join(', ')}.` });
  }

  const invoiceDate = invoice_date ? new Date(invoice_date) : new Date();
  if (Number.isNaN(invoiceDate.getTime())) {
    return res.status(400).json({ error: 'invoice_date is invalid.' });
  }

  try {
    const [beforeRows] = await pool.query('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (beforeRows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    req.auditBefore = beforeRows[0];
    req.auditIgnoreFields = ['created_by_name'];

    const [result] = await pool.query(
      `UPDATE invoices SET
        patient_uhid = ?, patient_name = ?, patient_age = ?, patient_gender = ?, patient_mobile = ?,
        patient_address = ?, doctor_name = ?, department = ?, payment_mode = ?, invoice_date = ?, bill_date = ?
       WHERE id = ?`,
      [
        patient_uhid,
        patient_name,
        patient_age || null,
        patient_gender || null,
        patient_mobile || null,
        patient_address || null,
        doctor_name || null,
        department || null,
        paymentMode,
        invoiceDate.toISOString().slice(0, 10),
        bill_date || null,
        req.params.id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    const [rows] = await pool.query(
      `SELECT invoices.*, users.full_name AS created_by_name
       FROM invoices
       LEFT JOIN users ON users.id = invoices.created_by
       WHERE invoices.id = ?`,
      [req.params.id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('Update invoice error:', err.message);
    res.status(500).json({ error: 'Failed to update invoice.' });
  }
});

// Replaces an invoice's line items and recomputes totals server-side (never
// trusting client-supplied prices/totals — same as invoice creation). If the
// invoice was already approved, editing its items invalidates that approval:
// the amount approvers signed off on no longer matches, so the chain resets
// to pending at every level and must be re-approved from the top.
router.put('/:id/items', requirePermission('invoices', 'edit'), async (req, res) => {
  const { items, discount_percent } = req.body || {};

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [req.params.id]);
    if (invoiceRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    const existingInvoice = invoiceRows[0];
    req.auditBefore = existingInvoice;
    req.auditIgnoreFields = ['created_by_name'];

    const totals = await computeInvoiceTotals(conn, items, discount_percent);

    await conn.query('DELETE FROM invoice_items WHERE invoice_id = ?', [req.params.id]);
    for (const line of totals.lines) {
      await conn.query(
        `INSERT INTO invoice_items
          (invoice_id, item_id, item_name, batch_no, expiry_date, quantity, mrp, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id,
          line.item_id,
          line.item_name,
          line.batch_no,
          line.expiry_date,
          line.quantity,
          line.mrp,
          line.line_total,
        ]
      );
    }

    const wasApproved = existingInvoice.approval_status === 'approved';

    await conn.query(
      `UPDATE invoices SET subtotal = ?, discount_percent = ?, discount_amount = ?, total_amount = ?
       WHERE id = ?`,
      [totals.subtotal, totals.discountPercent, totals.discountAmount, totals.totalAmount, req.params.id]
    );

    if (wasApproved) {
      await conn.query(
        `UPDATE invoice_approvals SET status = 'pending', acted_by = NULL, acted_at = NULL, remarks = NULL
         WHERE invoice_id = ?`,
        [req.params.id]
      );
      await conn.query('UPDATE invoices SET approval_status = ? WHERE id = ?', ['pending', req.params.id]);
    }

    await conn.commit();

    const [rows] = await pool.query(
      `SELECT invoices.*, users.full_name AS created_by_name
       FROM invoices
       LEFT JOIN users ON users.id = invoices.created_by
       WHERE invoices.id = ?`,
      [req.params.id]
    );
    const [itemRows] = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [req.params.id]);

    res.json({ ...rows[0], items: itemRows });
  } catch (err) {
    await conn.rollback();
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Update invoice items error:', err.message);
    res.status(500).json({ error: 'Failed to update invoice items.' });
  } finally {
    conn.release();
  }
});

router.get('/', requirePermission('invoices', 'view'), async (req, res) => {
  const { page = 1, pageSize = 20, from, to, patient_uhid, invoice_no, patient_name, search, approval_status, payment_mode } = req.query;

  const p = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (p - 1) * size;

  let where = 'WHERE 1=1';
  const params = [];

  if (from) {
    where += ' AND invoice_date >= ?';
    params.push(from);
  }
  if (to) {
    where += ' AND invoice_date <= ?';
    params.push(to);
  }
  if (patient_uhid) {
    where += ' AND patient_uhid LIKE ?';
    params.push(`%${patient_uhid}%`);
  }
  if (invoice_no) {
    where += ' AND LOWER(invoice_no) LIKE ?';
    params.push(`%${invoice_no.toLowerCase()}%`);
  }
  if (patient_name) {
    where += ' AND LOWER(patient_name) LIKE ?';
    params.push(`%${patient_name.toLowerCase()}%`);
  }
  if (search) {
    const s = `%${search.toLowerCase()}%`;
    where += ' AND (LOWER(invoice_no) LIKE ? OR LOWER(patient_name) LIKE ? OR LOWER(patient_uhid) LIKE ?)';
    params.push(s, s, s);
  }
  if (approval_status) {
    where += ' AND approval_status = ?';
    params.push(approval_status);
  }
  if (payment_mode) {
    where += ' AND payment_mode = ?';
    params.push(payment_mode);
  }

  try {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(total_amount), 0) AS grand_total FROM invoices ${where}`,
      params
    );
    const total = countRows[0].total;
    const grandTotal = countRows[0].grand_total;

    const [rows] = await pool.query(
      `SELECT id, invoice_no, patient_uhid, patient_name, invoice_date, total_amount, payment_mode, status, approval_status, created_at
       FROM invoices ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );

    res.json({ data: rows, page: p, pageSize: size, total, totalPages: Math.ceil(total / size), grandTotal });
  } catch (err) {
    console.error('List invoices error:', err.message);
    res.status(500).json({ error: 'Failed to fetch invoices.' });
  }
});

router.get('/:id', requirePermission('invoices', 'view'), async (req, res) => {
  try {
    const [invoiceRows] = await pool.query(
      `SELECT invoices.*, users.full_name AS created_by_name
       FROM invoices
       LEFT JOIN users ON users.id = invoices.created_by
       WHERE invoices.id = ?`,
      [req.params.id]
    );
    if (invoiceRows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    const [itemRows] = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [req.params.id]);

    const [vendorDocRows] = await pool.query(
      `SELECT ivd.*, vendors.name AS vendor_name, users.full_name AS uploaded_by_name
       FROM invoice_vendor_documents ivd
       JOIN vendors ON vendors.id = ivd.vendor_id
       LEFT JOIN users ON users.id = ivd.uploaded_by
       WHERE ivd.invoice_id = ?
       ORDER BY ivd.uploaded_at DESC`,
      [req.params.id]
    );

    const [approvalRows] = await pool.query(
      `SELECT ia.*, approval_levels.name AS level_name, approval_levels.sequence_order, users.full_name AS acted_by_name
       FROM invoice_approvals ia
       JOIN approval_levels ON approval_levels.id = ia.approval_level_id
       LEFT JOIN users ON users.id = ia.acted_by
       WHERE ia.invoice_id = ?
       ORDER BY approval_levels.sequence_order ASC`,
      [req.params.id]
    );

    res.json({ ...invoiceRows[0], items: itemRows, vendor_documents: vendorDocRows, approvals: approvalRows });
  } catch (err) {
    console.error('Get invoice error:', err.message);
    res.status(500).json({ error: 'Failed to fetch invoice.' });
  }
});

// --- Approval workflow ---
// Any one user assigned to the current pending level can approve or reject.
// Approving advances the invoice to the next level (or marks it fully
// approved if that was the last one); rejecting halts the chain — an admin
// must manually reset it (see the reset endpoint below) to restart.

async function assertUserCanActOnLevel(conn, userId, levelId) {
  const [rows] = await conn.query(
    'SELECT 1 FROM approval_level_users WHERE approval_level_id = ? AND user_id = ?',
    [levelId, userId]
  );
  return rows.length > 0;
}

router.post('/:id/approvals/:approvalId/approve', async (req, res) => {
  const { remarks } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT ia.*, approval_levels.sequence_order
       FROM invoice_approvals ia
       JOIN approval_levels ON approval_levels.id = ia.approval_level_id
       WHERE ia.id = ? AND ia.invoice_id = ?
       FOR UPDATE`,
      [req.params.approvalId, req.params.id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Approval step not found.' });
    }
    const approval = rows[0];

    if (approval.status !== 'pending') {
      await conn.rollback();
      return res.status(409).json({ error: `This approval step is already ${approval.status}.` });
    }

    // Must be the current step: no earlier level still pending.
    const [[{ earlierPending }]] = await conn.query(
      `SELECT COUNT(*) AS earlierPending
       FROM invoice_approvals ia
       JOIN approval_levels ON approval_levels.id = ia.approval_level_id
       WHERE ia.invoice_id = ? AND ia.status = 'pending' AND approval_levels.sequence_order < ?`,
      [req.params.id, approval.sequence_order]
    );
    if (earlierPending > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'An earlier approval level is still pending.' });
    }

    if (!(await assertUserCanActOnLevel(conn, req.user.id, approval.approval_level_id))) {
      await conn.rollback();
      return res.status(403).json({ error: 'You are not an approver for this level.' });
    }

    await conn.query(
      'UPDATE invoice_approvals SET status = ?, acted_by = ?, acted_at = NOW(), remarks = ? WHERE id = ?',
      ['approved', req.user.id, remarks || null, req.params.approvalId]
    );

    const [[{ remainingPending }]] = await conn.query(
      `SELECT COUNT(*) AS remainingPending FROM invoice_approvals WHERE invoice_id = ? AND status = 'pending'`,
      [req.params.id]
    );

    if (remainingPending === 0) {
      await conn.query('UPDATE invoices SET approval_status = ? WHERE id = ?', ['approved', req.params.id]);
    }

    await conn.commit();

    const [updated] = await pool.query('SELECT approval_status FROM invoices WHERE id = ?', [req.params.id]);
    res.json({ ok: true, invoice_approval_status: updated[0].approval_status });
  } catch (err) {
    await conn.rollback();
    console.error('Approve invoice error:', err.message);
    res.status(500).json({ error: 'Failed to approve.' });
  } finally {
    conn.release();
  }
});

router.post('/:id/approvals/:approvalId/reject', async (req, res) => {
  const { remarks } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Only admin role (role_id = 1) can reject invoices
    const [userRows] = await conn.query('SELECT role_id FROM users WHERE id = ?', [req.user.id]);
    if (!userRows.length || userRows[0].role_id !== 1) {
      await conn.rollback();
      return res.status(403).json({ error: 'Only administrators can reject invoices.' });
    }

    const [rows] = await conn.query(
      'SELECT * FROM invoice_approvals WHERE id = ? AND invoice_id = ? FOR UPDATE',
      [req.params.approvalId, req.params.id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Approval step not found.' });
    }
    const approval = rows[0];

    if (approval.status === 'rejected') {
      await conn.rollback();
      return res.status(409).json({ error: 'This approval step is already rejected.' });
    }

    await conn.query(
      'UPDATE invoice_approvals SET status = ?, acted_by = ?, acted_at = NOW(), remarks = ? WHERE id = ?',
      ['rejected', req.user.id, remarks || null, req.params.approvalId]
    );
    await conn.query('UPDATE invoices SET approval_status = ? WHERE id = ?', ['rejected', req.params.id]);

    await conn.commit();

    res.json({ ok: true, invoice_approval_status: 'rejected' });
  } catch (err) {
    await conn.rollback();
    console.error('Reject invoice error:', err.message);
    res.status(500).json({ error: 'Failed to reject.' });
  } finally {
    conn.release();
  }
});

// Resets a rejected invoice back to pending at every level, so the approval
// chain can restart from the top. Gated on approval_levels edit access, since
// this is an administrative action over the approval workflow itself.
router.post('/:id/approvals/reset', requirePermission('approval_levels', 'edit'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.query('SELECT approval_status FROM invoices WHERE id = ? FOR UPDATE', [
      req.params.id,
    ]);
    if (invoiceRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    req.auditBefore = { approval_status: invoiceRows[0].approval_status };

    await conn.query(
      `UPDATE invoice_approvals SET status = 'pending', acted_by = NULL, acted_at = NULL, remarks = NULL
       WHERE invoice_id = ?`,
      [req.params.id]
    );
    await conn.query('UPDATE invoices SET approval_status = ? WHERE id = ?', ['pending', req.params.id]);

    await conn.commit();

    res.json({ ok: true, invoice_approval_status: 'pending' });
  } catch (err) {
    await conn.rollback();
    console.error('Reset invoice approvals error:', err.message);
    res.status(500).json({ error: 'Failed to reset approvals.' });
  } finally {
    conn.release();
  }
});

// --- Vendor document attachments (scanned vendor invoices/delivery notes) ---

function handleUpload(req, res, next) {
  vendorDocumentUpload.single('file')(req, res, (err) => {
    if (err) {
      // multer's fileFilter/size-limit errors land here, not in the async
      // route handler's try/catch — translate them into a normal JSON 400.
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 10MB).' : err.message || 'Upload failed.';
      return res.status(400).json({ error: message });
    }
    next();
  });
}

router.post(
  '/:id/vendor-documents',
  requirePermission('vendor_documents', 'create'),
  handleUpload,
  async (req, res) => {
  const { vendor_id, vendor_invoice_no, vendor_invoice_date } = req.body || {};

  if (!req.file) {
    return res.status(400).json({ error: 'A file is required.' });
  }

  if (!vendor_id) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'vendor_id is required.' });
  }

  try {
    const [invoiceRows] = await pool.query('SELECT id, invoice_no FROM invoices WHERE id = ?', [req.params.id]);
    if (invoiceRows.length === 0) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    const invoiceNo = invoiceRows[0].invoice_no;

    const [vendorRows] = await pool.query('SELECT id FROM vendors WHERE id = ?', [vendor_id]);
    if (vendorRows.length === 0) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Selected vendor does not exist.' });
    }

    const [result] = await pool.query(
      `INSERT INTO invoice_vendor_documents
        (invoice_id, vendor_id, vendor_invoice_no, vendor_invoice_date, original_filename, stored_filename, mime_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        vendor_id,
        vendor_invoice_no || null,
        vendor_invoice_date || null,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        req.user.id,
      ]
    );

    // Move the file onto the NAS only after the DB row exists, so a NAS write
    // failure can be recovered by simply deleting the just-inserted row —
    // never leaving a DB record pointing at a file that doesn't exist anywhere.
    try {
      await moveToNas(req.file.path, invoiceNo, req.file.filename);
    } catch (moveErr) {
      await pool.query('DELETE FROM invoice_vendor_documents WHERE id = ?', [result.insertId]);
      fs.unlink(req.file.path, () => {});
      console.error('Move vendor document to NAS failed:', moveErr.message);
      return res.status(500).json({ error: 'Failed to store vendor document. Please try again.' });
    }

    const [rows] = await pool.query(
      `SELECT ivd.*, vendors.name AS vendor_name, users.full_name AS uploaded_by_name
       FROM invoice_vendor_documents ivd
       JOIN vendors ON vendors.id = ivd.vendor_id
       LEFT JOIN users ON users.id = ivd.uploaded_by
       WHERE ivd.id = ?`,
      [result.insertId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    console.error('Upload vendor document error:', err.message);
    res.status(500).json({ error: 'Failed to upload vendor document.' });
  }
  }
);

router.put(
  '/:id/vendor-documents/:docId',
  requirePermission('vendor_documents', 'edit'),
  handleUpload,
  async (req, res) => {
  const { vendor_id, vendor_invoice_no, vendor_invoice_date } = req.body || {};

  if (!vendor_id) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'vendor_id is required.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT ivd.*, invoices.invoice_no
       FROM invoice_vendor_documents ivd
       JOIN invoices ON invoices.id = ivd.invoice_id
       WHERE ivd.id = ? AND ivd.invoice_id = ?`,
      [req.params.docId, req.params.id]
    );
    if (rows.length === 0) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Document not found.' });
    }
    const existing = rows[0];
    req.auditBefore = existing;
    req.auditIgnoreFields = ['invoice_no', 'vendor_name', 'uploaded_by_name'];

    const [vendorRows] = await pool.query('SELECT id FROM vendors WHERE id = ?', [vendor_id]);
    if (vendorRows.length === 0) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Selected vendor does not exist.' });
    }

    let originalFilename = existing.original_filename;
    let storedFilename = existing.stored_filename;
    let mimeType = existing.mime_type;
    let fileSize = existing.file_size;

    if (req.file) {
      try {
        await moveToNas(req.file.path, existing.invoice_no, req.file.filename);
      } catch (moveErr) {
        fs.unlink(req.file.path, () => {});
        console.error('Move replacement vendor document to NAS failed:', moveErr.message);
        return res.status(500).json({ error: 'Failed to store replacement file. Please try again.' });
      }

      const oldStoredFilename = existing.stored_filename;
      originalFilename = req.file.originalname;
      storedFilename = req.file.filename;
      mimeType = req.file.mimetype;
      fileSize = req.file.size;

      try {
        await deleteFromNas(existing.invoice_no, oldStoredFilename);
      } catch (nasErr) {
        console.error('Failed to remove old vendor document from NAS:', existing.invoice_no, oldStoredFilename, nasErr.message);
      }
    }

    await pool.query(
      `UPDATE invoice_vendor_documents
       SET vendor_id = ?, vendor_invoice_no = ?, vendor_invoice_date = ?,
           original_filename = ?, stored_filename = ?, mime_type = ?, file_size = ?
       WHERE id = ?`,
      [
        vendor_id,
        vendor_invoice_no || null,
        vendor_invoice_date || null,
        originalFilename,
        storedFilename,
        mimeType,
        fileSize,
        req.params.docId,
      ]
    );

    const [updatedRows] = await pool.query(
      `SELECT ivd.*, vendors.name AS vendor_name, users.full_name AS uploaded_by_name
       FROM invoice_vendor_documents ivd
       JOIN vendors ON vendors.id = ivd.vendor_id
       LEFT JOIN users ON users.id = ivd.uploaded_by
       WHERE ivd.id = ?`,
      [req.params.docId]
    );

    res.json(updatedRows[0]);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('Update vendor document error:', err.message);
    res.status(500).json({ error: 'Failed to update vendor document.' });
  }
  }
);

router.get('/:id/vendor-documents/:docId/file', requirePermission('vendor_documents', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ivd.*, invoices.invoice_no
       FROM invoice_vendor_documents ivd
       JOIN invoices ON invoices.id = ivd.invoice_id
       WHERE ivd.id = ? AND ivd.invoice_id = ?`,
      [req.params.docId, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const doc = rows[0];

    if (!(await nasFileExists(doc.invoice_no, doc.stored_filename))) {
      console.error('Vendor document file missing on NAS:', doc.invoice_no, doc.stored_filename);
      return res.status(404).json({ error: 'File not found.' });
    }

    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.original_filename)}"`);
    res.sendFile(path.resolve(nasFilePath(doc.invoice_no, doc.stored_filename)));
  } catch (err) {
    console.error('Serve vendor document error:', err.message);
    res.status(500).json({ error: 'Failed to fetch document.' });
  }
});

router.delete(
  '/:id/vendor-documents/:docId',
  requirePermission('vendor_documents', 'delete'),
  async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ivd.*, invoices.invoice_no
       FROM invoice_vendor_documents ivd
       JOIN invoices ON invoices.id = ivd.invoice_id
       WHERE ivd.id = ? AND ivd.invoice_id = ?`,
      [req.params.docId, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    req.auditBefore = rows[0];
    req.auditIgnoreFields = ['invoice_no'];

    await pool.query('DELETE FROM invoice_vendor_documents WHERE id = ?', [req.params.docId]);

    try {
      await deleteFromNas(rows[0].invoice_no, rows[0].stored_filename);
    } catch (nasErr) {
      console.error('Failed to remove vendor document from NAS:', rows[0].invoice_no, rows[0].stored_filename, nasErr.message);
    }

    res.status(204).send();
  } catch (err) {
    console.error('Delete vendor document error:', err.message);
    res.status(500).json({ error: 'Failed to delete vendor document.' });
  }
  }
);

// Save bill_date when user prints
router.patch('/:id/bill-date', requirePermission('invoices', 'view'), async (req, res) => {
  const { bill_date } = req.body || {};
  if (!bill_date) return res.status(400).json({ error: 'bill_date is required.' });
  try {
    await pool.query('UPDATE invoices SET bill_date = ? WHERE id = ?', [bill_date, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Save bill_date error:', err.message);
    res.status(500).json({ error: 'Failed to save bill date.' });
  }
});

module.exports = router;
