const express = require('express');
const pool = require('../db/mysql');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { SCREEN_LIST } = require('../constants/screens');

const router = express.Router();

router.use(requireAuth);

router.get('/', requirePermission('audit_log', 'view'), async (req, res) => {
  const { screen, action, username, from, to } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

  const where = [];
  const params = [];

  if (screen && SCREEN_LIST.includes(screen)) {
    where.push('screen = ?');
    params.push(screen);
  }
  if (action && ['create', 'update', 'delete'].includes(action)) {
    where.push('action = ?');
    params.push(action);
  }
  if (username) {
    where.push('username LIKE ?');
    params.push(`%${username}%`);
  }
  if (from) {
    where.push('created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(to);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const [[{ count }]] = await pool.query(`SELECT COUNT(*) AS count FROM audit_log ${whereClause}`, params);

    const [rows] = await pool.query(
      `SELECT * FROM audit_log ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );

    res.json({ entries: rows, total: count, page, pageSize });
  } catch (err) {
    console.error('List audit log error:', err.message);
    res.status(500).json({ error: 'Failed to fetch audit log.' });
  }
});

module.exports = router;
