const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/mysql');
const { loadRolePermissions } = require('../utils/permissions');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT users.id, users.username, users.password_hash, users.full_name, users.is_active,
              users.role_id, roles.name AS role_name
       FROM users
       JOIN roles ON roles.id = users.role_id
       WHERE users.username = ? LIMIT 1`,
      [username]
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const permissions = await loadRolePermissions(user.role_id);

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role_id: user.role_id,
        role_name: user.role_name,
        permissions,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role_id: user.role_id,
        role_name: user.role_name,
        permissions,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed due to a server error.' });
  }
});

module.exports = router;
