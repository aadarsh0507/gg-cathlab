const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db/mysql');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { vendorDocumentUpload } = require('../middleware/vendorDocumentUpload');
const { moveToNas, deleteFromNas, nasFileExists, nasFilePath } = require('../utils/nasStorage');

const router = express.Router();
router.use(requireAuth);

// Root NAS folder for all standalone vendor documents.
const NAS_FOLDER = 'VENDOR-DOCS-STANDALONE';

// Files are stored under:
//   VENDOR-DOCS-STANDALONE/GG00043557_VIJAYA_V/2026-07-21/filename
// Files without a patient: VENDOR-DOCS-STANDALONE/NO-PATIENT/2026-07-21/filename
// Folder is derived at runtime from DB columns — no extra DB column needed.
function docFolder(patientUhid, patientName, uploadedAt) {
  const dateStr = uploadedAt
    ? new Date(uploadedAt).toISOString().slice(0, 10)   // YYYY-MM-DD
    : new Date().toISOString().slice(0, 10);

  const patientSegment = patientUhid
    ? `${patientUhid.toUpperCase().replace(/[^A-Z0-9\-]/g, '_')}_${(patientName || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9\-\.]/g, '_')}`
    : 'NO-PATIENT';

  return `${NAS_FOLDER}/${patientSegment}/${dateStr}`;
}

function handleUpload(req, res, next) {
  vendorDocumentUpload.single('file')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 10MB).' : err.message || 'Upload failed.';
      return res.status(400).json({ error: message });
    }
    next();
  });
}

// List / search
router.get('/', requirePermission('vendor_documents', 'view'), async (req, res) => {
  const { vendor_id, vendor_invoice_no, patient_uhid, date_from, date_to, page = 1, limit = 20 } = req.query;

  const p = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (p - 1) * size;

  let where = 'WHERE 1=1';
  const params = [];

  if (vendor_id) {
    where += ' AND svd.vendor_id = ?';
    params.push(vendor_id);
  }
  if (patient_uhid) {
    where += ' AND svd.patient_uhid LIKE ?';
    params.push(`%${patient_uhid}%`);
  }
  if (vendor_invoice_no) {
    where += ' AND svd.vendor_invoice_no LIKE ?';
    params.push(`%${vendor_invoice_no}%`);
  }
  if (date_from) {
    where += ' AND svd.uploaded_at >= ?';
    params.push(date_from);
  }
  if (date_to) {
    where += ' AND svd.uploaded_at <= ?';
    params.push(`${date_to} 23:59:59`);
  }

  const fromJoin = `
    FROM standalone_vendor_documents svd
    JOIN vendors ON vendors.id = svd.vendor_id
    LEFT JOIN users ON users.id = svd.uploaded_by
    ${where}
  `;

  try {
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total ${fromJoin}`, params);
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT
        svd.id,
        svd.vendor_id,
        vendors.name AS vendor_name,
        svd.patient_uhid,
        svd.patient_name,
        svd.vendor_invoice_no,
        svd.vendor_invoice_date,
        svd.remarks,
        svd.original_filename,
        svd.stored_filename,
        svd.mime_type,
        svd.file_size,
        svd.uploaded_by,
        users.full_name AS uploaded_by_name,
        svd.uploaded_at
      ${fromJoin}
      ORDER BY svd.uploaded_at DESC
      LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );

    res.json({ data: rows, page: p, limit: size, total, totalPages: Math.ceil(total / size) });
  } catch (err) {
    console.error('List standalone vendor documents error:', err.message);
    res.status(500).json({ error: 'Failed to fetch vendor documents.' });
  }
});

// Upload
router.post('/', requirePermission('vendor_documents', 'create'), handleUpload, async (req, res) => {
  const { vendor_id, vendor_invoice_no, vendor_invoice_date, remarks, patient_uhid, patient_name } = req.body || {};

  if (!req.file) {
    return res.status(400).json({ error: 'A file is required.' });
  }
  if (!vendor_id) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'vendor_id is required.' });
  }

  try {
    const [vendorRows] = await pool.query('SELECT id FROM vendors WHERE id = ?', [vendor_id]);
    if (vendorRows.length === 0) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Selected vendor does not exist.' });
    }

    const [result] = await pool.query(
      `INSERT INTO standalone_vendor_documents
        (vendor_id, patient_uhid, patient_name, vendor_invoice_no, vendor_invoice_date, remarks, original_filename, stored_filename, mime_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vendor_id,
        patient_uhid || null,
        patient_name || null,
        vendor_invoice_no || null,
        vendor_invoice_date || null,
        remarks || null,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        req.user.id,
      ]
    );

    try {
      await moveToNas(req.file.path, docFolder(patient_uhid, patient_name, null), req.file.filename);
    } catch (moveErr) {
      await pool.query('DELETE FROM standalone_vendor_documents WHERE id = ?', [result.insertId]);
      fs.unlink(req.file.path, () => {});
      console.error('Move standalone vendor document to NAS failed:', moveErr.message);
      return res.status(500).json({ error: 'Failed to store vendor document. Please try again.' });
    }

    const [rows] = await pool.query(
      `SELECT svd.*, vendors.name AS vendor_name, users.full_name AS uploaded_by_name
       FROM standalone_vendor_documents svd
       JOIN vendors ON vendors.id = svd.vendor_id
       LEFT JOIN users ON users.id = svd.uploaded_by
       WHERE svd.id = ?`,
      [result.insertId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    console.error('Upload standalone vendor document error:', err.message);
    res.status(500).json({ error: 'Failed to upload vendor document.' });
  }
});

// View / download file
router.get('/:id/file', requirePermission('vendor_documents', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM standalone_vendor_documents WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Document not found.' });

    const doc = rows[0];
    const folder = docFolder(doc.patient_uhid, doc.patient_name, doc.uploaded_at);
    const filePath = nasFilePath(folder, doc.stored_filename);

    if (!(await nasFileExists(folder, doc.stored_filename))) {
      return res.status(404).json({ error: 'File not found on storage.' });
    }

    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.original_filename)}"`);
    // Use absolute path resolution so res.sendFile works on both Linux and Windows.
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    console.error('View standalone vendor document error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve file.' });
  }
});

// Edit metadata (optionally replace file)
router.put('/:id', requirePermission('vendor_documents', 'edit'), handleUpload, async (req, res) => {
  const { vendor_id, vendor_invoice_no, vendor_invoice_date, remarks, patient_uhid, patient_name } = req.body || {};

  if (!vendor_id) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'vendor_id is required.' });
  }

  try {
    const [existing] = await pool.query('SELECT * FROM standalone_vendor_documents WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Document not found.' });
    }

    const doc = existing[0];
    let storedFilename = doc.stored_filename;
    let originalFilename = doc.original_filename;
    let mimeType = doc.mime_type;
    let fileSize = doc.file_size;
    const oldStoredFilename = doc.stored_filename;
    // Old file lives in the folder derived from its original upload date + patient.
    // New replacement file always uses today's date.
    const oldFolder = docFolder(doc.patient_uhid, doc.patient_name, doc.uploaded_at);
    const newFolder = docFolder(patient_uhid || doc.patient_uhid, patient_name || doc.patient_name, null);

    if (req.file) {
      try {
        await moveToNas(req.file.path, newFolder, req.file.filename);
      } catch (moveErr) {
        fs.unlink(req.file.path, () => {});
        return res.status(500).json({ error: 'Failed to store replacement file. Please try again.' });
      }
      storedFilename = req.file.filename;
      originalFilename = req.file.originalname;
      mimeType = req.file.mimetype;
      fileSize = req.file.size;
    }

    await pool.query(
      `UPDATE standalone_vendor_documents
       SET vendor_id = ?, patient_uhid = ?, patient_name = ?, vendor_invoice_no = ?, vendor_invoice_date = ?, remarks = ?,
           original_filename = ?, stored_filename = ?, mime_type = ?, file_size = ?
       WHERE id = ?`,
      [
        vendor_id,
        patient_uhid || null,
        patient_name || null,
        vendor_invoice_no || null,
        vendor_invoice_date || null,
        remarks || null,
        originalFilename,
        storedFilename,
        mimeType,
        fileSize,
        req.params.id,
      ]
    );

    if (req.file) {
      deleteFromNas(oldFolder, oldStoredFilename).catch((e) =>
        console.error('Failed to remove old standalone vendor doc from NAS:', oldStoredFilename, e.message)
      );
    }

    const [rows] = await pool.query(
      `SELECT svd.*, vendors.name AS vendor_name, users.full_name AS uploaded_by_name
       FROM standalone_vendor_documents svd
       JOIN vendors ON vendors.id = svd.vendor_id
       LEFT JOIN users ON users.id = svd.uploaded_by
       WHERE svd.id = ?`,
      [req.params.id]
    );

    res.json(rows[0]);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('Update standalone vendor document error:', err.message);
    res.status(500).json({ error: 'Failed to update vendor document.' });
  }
});

// Delete
router.delete('/:id', requirePermission('vendor_documents', 'delete'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM standalone_vendor_documents WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Document not found.' });

    await pool.query('DELETE FROM standalone_vendor_documents WHERE id = ?', [req.params.id]);

    deleteFromNas(docFolder(rows[0].patient_uhid, rows[0].patient_name, rows[0].uploaded_at), rows[0].stored_filename).catch((e) =>
      console.error('Failed to delete standalone vendor doc from NAS:', rows[0].stored_filename, e.message)
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Delete standalone vendor document error:', err.message);
    res.status(500).json({ error: 'Failed to delete vendor document.' });
  }
});

module.exports = router;
