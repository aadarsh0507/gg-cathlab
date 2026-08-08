require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const authRoutes = require('../routes/auth');
const patientRoutes = require('../routes/patients');
const itemRoutes = require('../routes/items');
const invoiceRoutes = require('../routes/invoices');
const userRoutes = require('../routes/users');
const categoryRoutes = require('../routes/categories');
const unitRoutes = require('../routes/units');
const vendorRoutes = require('../routes/vendors');
const vendorDocumentRoutes = require('../routes/vendorDocuments');
const standaloneVendorDocumentRoutes = require('../routes/standaloneVendorDocuments');
const approvalLevelRoutes = require('../routes/approvalLevels');
const roleRoutes = require('../routes/roles');
const auditLogRoutes = require('../routes/auditLog');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/version', (req, res) => res.json({
  commit: process.env.GIT_COMMIT || 'unknown',
  version: process.env.APP_VERSION || 'unknown',
  built_at: process.env.BUILD_TIME || 'unknown',
}));

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/vendor-documents', vendorDocumentRoutes);
app.use('/api/standalone-vendor-documents', standaloneVendorDocumentRoutes);
app.use('/api/approval-levels', approvalLevelRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/audit-log', auditLogRoutes);

// Serve the built frontend (present in the Docker image; absent in local dev
// where the frontend runs separately via `npm run dev`). SPA fallback only
// applies to non-API GET requests so unmatched /api/* routes still 404 as JSON.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Cathlab billing server listening on port ${PORT}`);
});
