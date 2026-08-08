const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Transient local staging directory only — multer needs somewhere on local
// disk to write the incoming multipart stream to. The route handler moves the
// finished file onto the NAS share immediately after the DB insert commits and
// removes it from here; nothing should ever be served from this folder.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'vendor-documents');

// Ensure the staging directory exists at startup so multer never fails with ENOENT.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const storedName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, storedName);
  },
});

const vendorDocumentUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Only PDF, JPEG, and PNG files are allowed.'));
    }
    cb(null, true);
  },
});

module.exports = { vendorDocumentUpload, UPLOAD_DIR, MAX_FILE_SIZE_BYTES };
