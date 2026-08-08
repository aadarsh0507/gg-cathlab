const express = require('express');
const pool = require('../db/mysql');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Levels + their assigned approvers in one response, ordered by sequence.
router.get('/', requirePermission('approval_levels', 'view'), async (req, res) => {
  try {
    const [levels] = await pool.query('SELECT * FROM approval_levels ORDER BY sequence_order ASC');

    const [assignments] = await pool.query(
      `SELECT alu.approval_level_id, users.id AS user_id, users.full_name, users.username
       FROM approval_level_users alu
       JOIN users ON users.id = alu.user_id
       ORDER BY users.full_name ASC`
    );

    const usersByLevel = new Map();
    for (const a of assignments) {
      if (!usersByLevel.has(a.approval_level_id)) usersByLevel.set(a.approval_level_id, []);
      usersByLevel.get(a.approval_level_id).push({ id: a.user_id, full_name: a.full_name, username: a.username });
    }

    res.json(levels.map((level) => ({ ...level, approvers: usersByLevel.get(level.id) || [] })));
  } catch (err) {
    console.error('List approval levels error:', err.message);
    res.status(500).json({ error: 'Failed to fetch approval levels.' });
  }
});

router.post('/', requirePermission('approval_levels', 'create'), async (req, res) => {
  const { name, sequence_order, is_active } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required.' });
  }
  if (sequence_order === undefined || sequence_order === null || Number.isNaN(Number(sequence_order))) {
    return res.status(400).json({ error: 'sequence_order is required and must be a number.' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO approval_levels (name, sequence_order, is_active) VALUES (?, ?, ?)',
      [name.trim(), Number(sequence_order), is_active === undefined ? 1 : is_active ? 1 : 0]
    );
    const [rows] = await pool.query('SELECT * FROM approval_levels WHERE id = ?', [result.insertId]);
    res.status(201).json({ ...rows[0], approvers: [] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A level with this name or sequence order already exists.' });
    }
    console.error('Create approval level error:', err.message);
    res.status(500).json({ error: 'Failed to create approval level.' });
  }
});

router.put('/:id', requirePermission('approval_levels', 'edit'), async (req, res) => {
  const { name, sequence_order, is_active } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required.' });
  }
  if (sequence_order === undefined || sequence_order === null || Number.isNaN(Number(sequence_order))) {
    return res.status(400).json({ error: 'sequence_order is required and must be a number.' });
  }

  try {
    const [beforeRows] = await pool.query('SELECT * FROM approval_levels WHERE id = ?', [req.params.id]);
    if (beforeRows.length === 0) {
      return res.status(404).json({ error: 'Approval level not found.' });
    }
    req.auditBefore = beforeRows[0];

    const [result] = await pool.query(
      'UPDATE approval_levels SET name = ?, sequence_order = ?, is_active = ? WHERE id = ?',
      [name.trim(), Number(sequence_order), is_active ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Approval level not found.' });
    }
    const [rows] = await pool.query('SELECT * FROM approval_levels WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A level with this name or sequence order already exists.' });
    }
    console.error('Update approval level error:', err.message);
    res.status(500).json({ error: 'Failed to update approval level.' });
  }
});

router.delete('/:id', requirePermission('approval_levels', 'delete'), async (req, res) => {
  try {
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM invoice_approvals WHERE approval_level_id = ? AND status != "pending"',
      [req.params.id]
    );
    if (count > 0) {
      return res.status(409).json({
        error: `Cannot delete this level — ${count} invoice(s) already have a recorded decision at this level.`,
      });
    }

    const [beforeRows] = await pool.query('SELECT * FROM approval_levels WHERE id = ?', [req.params.id]);
    req.auditBefore = beforeRows[0];

    const [result] = await pool.query('DELETE FROM approval_levels WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Approval level not found.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Delete approval level error:', err.message);
    res.status(500).json({ error: 'Failed to delete approval level.' });
  }
});

// Replace the full set of assigned approvers for a level.
router.put('/:id/approvers', requirePermission('approval_levels', 'edit'), async (req, res) => {
  const { user_ids } = req.body || {};

  if (!Array.isArray(user_ids)) {
    return res.status(400).json({ error: 'user_ids must be an array.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [levelRows] = await conn.query('SELECT id FROM approval_levels WHERE id = ?', [req.params.id]);
    if (levelRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Approval level not found.' });
    }

    await conn.query('DELETE FROM approval_level_users WHERE approval_level_id = ?', [req.params.id]);

    for (const userId of user_ids) {
      await conn.query('INSERT INTO approval_level_users (approval_level_id, user_id) VALUES (?, ?)', [
        req.params.id,
        userId,
      ]);
    }

    await conn.commit();

    const [assignments] = await pool.query(
      `SELECT users.id, users.full_name, users.username
       FROM approval_level_users alu
       JOIN users ON users.id = alu.user_id
       WHERE alu.approval_level_id = ?
       ORDER BY users.full_name ASC`,
      [req.params.id]
    );

    res.json(assignments);
  } catch (err) {
    await conn.rollback();
    console.error('Update approval level approvers error:', err.message);
    res.status(500).json({ error: 'Failed to update approvers.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
