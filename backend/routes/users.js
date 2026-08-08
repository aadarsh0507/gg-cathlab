const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/mysql');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

const SAFE_FIELDS = `users.id, users.username, users.full_name, users.role_id, roles.name AS role_name,
  users.is_active, users.created_at, users.updated_at`;
const BASE_JOIN = 'FROM users JOIN roles ON roles.id = users.role_id';

router.use(requireAuth);

router.get('/', requirePermission('users', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT ${SAFE_FIELDS} ${BASE_JOIN} ORDER BY users.username ASC`);
    res.json(rows);
  } catch (err) {
    console.error('List users error:', err.message);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

router.get('/:id', requirePermission('users', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT ${SAFE_FIELDS} ${BASE_JOIN} WHERE users.id = ?`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Get user error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

router.post('/', requirePermission('users', 'create'), async (req, res) => {
  const { username, password, full_name, role_id, is_active } = req.body || {};

  if (!username || !password || !full_name || !role_id) {
    return res.status(400).json({ error: 'username, password, full_name, and role_id are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const [roleRows] = await pool.query('SELECT id FROM roles WHERE id = ?', [role_id]);
    if (roleRows.length === 0) {
      return res.status(400).json({ error: 'Selected role does not exist.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role_id, is_active) VALUES (?, ?, ?, ?, ?)',
      [username, passwordHash, full_name, role_id, is_active === undefined ? 1 : is_active ? 1 : 0]
    );

    const [rows] = await pool.query(`SELECT ${SAFE_FIELDS} ${BASE_JOIN} WHERE users.id = ?`, [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A user with this username already exists.' });
    }
    console.error('Create user error:', err.message);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

router.put('/:id', requirePermission('users', 'edit'), async (req, res) => {
  const { username, password, full_name, role_id, is_active } = req.body || {};

  if (!username || !full_name || !role_id) {
    return res.status(400).json({ error: 'username, full_name, and role_id are required.' });
  }

  try {
    const [roleRows] = await pool.query('SELECT id FROM roles WHERE id = ?', [role_id]);
    if (roleRows.length === 0) {
      return res.status(400).json({ error: 'Selected role does not exist.' });
    }

    const [beforeRows] = await pool.query(`SELECT ${SAFE_FIELDS} ${BASE_JOIN} WHERE users.id = ?`, [req.params.id]);
    req.auditBefore = beforeRows[0];
    req.auditIgnoreFields = ['role_name'];

    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await pool.query(
        'UPDATE users SET username = ?, password_hash = ?, full_name = ?, role_id = ?, is_active = ? WHERE id = ?',
        [username, passwordHash, full_name, role_id, is_active ? 1 : 0, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE users SET username = ?, full_name = ?, role_id = ?, is_active = ? WHERE id = ?',
        [username, full_name, role_id, is_active ? 1 : 0, req.params.id]
      );
    }

    const [rows] = await pool.query(`SELECT ${SAFE_FIELDS} ${BASE_JOIN} WHERE users.id = ?`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A user with this username already exists.' });
    }
    console.error('Update user error:', err.message);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

router.delete('/:id', requirePermission('users', 'delete'), async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  try {
    const [beforeRows] = await pool.query(`SELECT ${SAFE_FIELDS} ${BASE_JOIN} WHERE users.id = ?`, [req.params.id]);
    if (beforeRows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    req.auditBefore = beforeRows[0];
    req.auditIgnoreFields = ['role_name'];

    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.status(204).send();
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({
        error: 'This user created existing invoices and cannot be deleted. Consider deactivating instead.',
      });
    }
    console.error('Delete user error:', err.message);
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

module.exports = router;
