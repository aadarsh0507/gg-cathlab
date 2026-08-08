const jwt = require('jsonwebtoken');
const pool = require('../db/mysql');
const { diffObjects } = require('../utils/diff');

const ACTION_TO_LOG = { create: 'create', edit: 'update', delete: 'delete' };

// Fire-and-forget: a logging failure must never break the actual request.
async function writeAuditLog(user, screen, action, recordId, details) {
  try {
    await pool.query(
      'INSERT INTO audit_log (user_id, username, screen, action, record_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [
        user.id,
        user.username,
        screen,
        ACTION_TO_LOG[action],
        recordId != null ? String(recordId) : null,
        details && Object.keys(details).length ? JSON.stringify(details) : null,
      ]
    );
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Permissions are fetched live from DB on every request so role changes take
// effect immediately without requiring a re-login.
function requirePermission(screen, action) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    try {
      const [rows] = await pool.query(
        `SELECT rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
         FROM role_permissions rp
         JOIN users u ON u.role_id = rp.role_id
         WHERE u.id = ? AND rp.screen = ?`,
        [req.user.id, screen]
      );
      const screenPerms = rows[0];
      if (!screenPerms || !screenPerms[`can_${action}`]) {
        return res.status(403).json({ error: 'You do not have permission to perform this action.' });
      }
    } catch (err) {
      console.error('Permission check failed:', err.message);
      return res.status(500).json({ error: 'Permission check failed.' });
    }

    // Auto-log create/edit/delete on success, without touching every route
    // handler's control flow: wrap res.json/res.send so a 2xx response fires
    // a fire-and-forget audit write. Handlers that want a field-level diff
    // set `req.auditBefore = row` (the pre-mutation DB row) before they
    // mutate; this middleware diffs it against the response body (the "after"
    // state) for create/update, or logs the before-snapshot alone for delete
    // (fields all show as removed, since there's no "after"). Handlers that
    // don't set req.auditBefore still get a bare log entry (id + action),
    // same as before this diffing was added.
    if (ACTION_TO_LOG[action]) {
      // res.json() internally calls res.send(), so patching both would
      // double-log a single response — one guard flag ensures only the
      // first hook to see a given response actually writes the log entry.
      let logged = false;

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (!logged && res.statusCode >= 200 && res.statusCode < 300) {
          logged = true;
          // For create, the URL param (if any) identifies the parent
          // resource, not the new record — prefer the response body's own id.
          const recordId = action === 'create' ? (body?.id ?? req.params.id) : (req.params.id ?? body?.id);
          const details = req.auditBefore !== undefined || body ? diffObjects(req.auditBefore, body, req.auditIgnoreFields) : undefined;
          writeAuditLog(req.user, screen, action, recordId, details);
        }
        return originalJson(body);
      };

      const originalSend = res.send.bind(res);
      res.send = (body) => {
        if (!logged && res.statusCode >= 200 && res.statusCode < 300) {
          logged = true;
          const details = req.auditBefore ? diffObjects(req.auditBefore, null, req.auditIgnoreFields) : undefined;
          writeAuditLog(req.user, screen, action, req.params.id, details);
        }
        return originalSend(body);
      };
    }

    next();
  };
}

module.exports = { requireAuth, requirePermission };
