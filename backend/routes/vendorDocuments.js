const express = require('express');
const pool = require('../db/mysql');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Cross-invoice search over vendor document attachments, so staff can find a
// scanned vendor invoice by patient or vendor without opening invoices one by one.
router.get('/', async (req, res) => {
  const { patient_uhid, invoice_no, vendor_id, date_from, date_to, page = 1, limit = 20 } = req.query;

  const p = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (p - 1) * size;

  let where = 'WHERE 1=1';
  const params = [];

  if (patient_uhid) {
    where += ' AND invoices.patient_uhid LIKE ?';
    params.push(`%${patient_uhid}%`);
  }
  if (invoice_no) {
    where += ' AND invoices.invoice_no LIKE ?';
    params.push(`%${invoice_no}%`);
  }
  if (vendor_id) {
    where += ' AND ivd.vendor_id = ?';
    params.push(vendor_id);
  }
  if (date_from) {
    where += ' AND ivd.uploaded_at >= ?';
    params.push(date_from);
  }
  if (date_to) {
    where += ' AND ivd.uploaded_at <= ?';
    params.push(`${date_to} 23:59:59`);
  }

  const fromJoin = `
    FROM invoice_vendor_documents ivd
    JOIN invoices ON invoices.id = ivd.invoice_id
    JOIN vendors ON vendors.id = ivd.vendor_id
    LEFT JOIN users ON users.id = ivd.uploaded_by
    ${where}
  `;

  try {
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total ${fromJoin}`, params);
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT
        ivd.id AS document_id,
        ivd.invoice_id,
        invoices.patient_uhid,
        invoices.patient_name,
        invoices.invoice_no,
        invoices.invoice_date,
        ivd.vendor_id,
        vendors.name AS vendor_name,
        ivd.vendor_invoice_no,
        ivd.vendor_invoice_date,
        ivd.original_filename,
        ivd.uploaded_at,
        users.full_name AS uploaded_by_name
      ${fromJoin}
      ORDER BY ivd.uploaded_at DESC
      LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );

    res.json({ data: rows, page: p, limit: size, total, totalPages: Math.ceil(total / size) });
  } catch (err) {
    console.error('List vendor documents error:', err.message);
    res.status(500).json({ error: 'Failed to fetch vendor documents.' });
  }
});

module.exports = router;
