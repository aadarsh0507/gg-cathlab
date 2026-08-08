const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const NAS_SHARE_PATH = process.env.NAS_SHARE_PATH;

function assertConfigured() {
  if (!NAS_SHARE_PATH) {
    throw new Error('NAS_SHARE_PATH is not configured.');
  }
}

// Files are organized under a per-invoice folder named by the human-readable
// invoice number (e.g. IMP-2026-000005), not the numeric invoice id, since
// that's the identifier staff recognize when browsing the NAS directly.
function invoiceFolderPath(invoiceNo) {
  assertConfigured();
  return path.join(NAS_SHARE_PATH, invoiceNo);
}

function nasFilePath(invoiceNo, storedFilename) {
  return path.join(invoiceFolderPath(invoiceNo), storedFilename);
}

// Moves a freshly-uploaded file from local staging (multer's temp dir) onto
// the NAS share, into a folder named after the invoice number, then removes
// the local copy. Called only after the DB row referencing storedFilename has
// committed, so a failure here never leaves an orphaned DB record pointing at
// a file that isn't anywhere.
async function moveToNas(localPath, invoiceNo, storedFilename) {
  const folder = invoiceFolderPath(invoiceNo);
  await fsPromises.mkdir(folder, { recursive: true });

  const destPath = nasFilePath(invoiceNo, storedFilename);
  await fsPromises.copyFile(localPath, destPath);
  await fsPromises.unlink(localPath);
}

async function deleteFromNas(invoiceNo, storedFilename) {
  const filePath = nasFilePath(invoiceNo, storedFilename);
  try {
    await fsPromises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function nasFileExists(invoiceNo, storedFilename) {
  try {
    await fsPromises.access(nasFilePath(invoiceNo, storedFilename), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = { moveToNas, deleteFromNas, nasFileExists, nasFilePath };
