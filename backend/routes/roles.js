const express = require('express');
const pool = require('../db/mysql');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { SCREEN_LIST } = require('../constants/screens');
const { loadRolePermissions } = require('../utils/permissions');

const router = express.Router();

router.use(requireAuth);

async function attachPermissions(roles) {
  const result = [];
  for (const role of roles) {
    const permissions = await loadRolePermissions(role.id);
    result.push({ ...role, permissions });
  }
  return result;
}

router.get('/', requirePermission('roles', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM roles ORDER BY name ASC');
    res.json(await attachPermissions(rows));
  } catch (err) {
    console.error('List roles error:', err.message);
    res.status(500).json({ error: 'Failed to fetch roles.' });
  }
});

router.get('/:id', requirePermission('roles', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Role not found.' });
    }
    const [withPerms] = await attachPermissions(rows);
    res.json(withPerms);
  } catch (err) {
    console.error('Get role error:', err.message);
    res.status(500).json({ error: 'Failed to fetch role.' });
  }
});

router.post('/', requirePermission('roles', 'create'), async (req, res) => {
  const { name, description, is_active } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required.' });
  }

  try {
    const [result] = await pool.query('INSERT INTO roles (name, description, is_active) VALUES (?, ?, ?)', [
      name.trim(),
      description || null,
      is_active === undefined ? 1 : is_active ? 1 : 0,
    ]);

    const [rows] = await pool.query('SELECT * FROM roles WHERE id = ?', [result.insertId]);
    res.status(201).json({ ...rows[0], permissions: {} });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `A role named '${name}' already exists.` });
    }
    console.error('Create role error:', err.message);
    res.status(500).json({ error: 'Failed to create role.' });
  }
});

router.put('/:id', requirePermission('roles', 'edit'), async (req, res) => {
  const { name, description, is_active } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required.' });
  }

  try {
    const [beforeRows] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (beforeRows.length === 0) {
      return res.status(404).json({ error: 'Role not found.' });
    }
    req.auditBefore = beforeRows[0];

    const [result] = await pool.query('UPDATE roles SET name = ?, description = ?, is_active = ? WHERE id = ?', [
      name.trim(),
      description || null,
      is_active ? 1 : 0,
      req.params.id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Role not found.' });
    }

    const [rows] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    const [withPerms] = await attachPermissions(rows);
    res.json(withPerms);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `A role named '${name}' already exists.` });
    }
    console.error('Update role error:', err.message);
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

router.delete('/:id', requirePermission('roles', 'delete'), async (req, res) => {
  try {
    const [roleRows] = await pool.query('SELECT name FROM roles WHERE id = ?', [req.params.id]);
    if (roleRows.length === 0) {
      return res.status(404).json({ error: 'Role not found.' });
    }
    if (roleRows[0].name === 'admin') {
      return res.status(400).json({ error: 'The built-in admin role cannot be deleted.' });
    }

    const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM users WHERE role_id = ?', [req.params.id]);
    if (count > 0) {
      return res.status(409).json({
        error: `Cannot delete this role — ${count} user(s) are assigned to it.`,
      });
    }

    const [beforeRows] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    req.auditBefore = beforeRows[0];

    const [result] = await pool.query('DELETE FROM roles WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Role not found.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Delete role error:', err.message);
    res.status(500).json({ error: 'Failed to delete role.' });
  }
});

// Replace the full permission matrix for a role in one call: body is
// { permissions: { [screen]: { can_view, can_create, can_edit, can_delete } } }.
// Unknown screen keys are ignored; missing screens are treated as all-false.
router.put('/:id/permissions', requirePermission('roles', 'edit'), async (req, res) => {
  const { permissions } = req.body || {};

  if (!permissions || typeof permissions !== 'object') {
    return res.status(400).json({ error: 'permissions must be an object.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [roleRows] = await conn.query('SELECT id, name FROM roles WHERE id = ?', [req.params.id]);
    if (roleRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Role not found.' });
    }

    // Guard against locking every admin out of role management: the built-in
    // "admin" role must always retain full access to the roles screen itself.
    if (roleRows[0].name === 'admin') {
      const rolesPerm = permissions.roles || {};
      if (!rolesPerm.can_view || !rolesPerm.can_edit) {
        await conn.rollback();
        return res.status(400).json({
          error: 'The admin role must always retain view and edit access to the Roles screen.',
        });
      }
    }

    req.auditBefore = await loadRolePermissions(req.params.id);

    for (const screen of SCREEN_LIST) {
      const p = permissions[screen] || {};
      await conn.query(
        `INSERT INTO role_permissions (role_id, screen, can_view, can_create, can_edit, can_delete)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_create = VALUES(can_create),
           can_edit = VALUES(can_edit), can_delete = VALUES(can_delete)`,
        [req.params.id, screen, p.can_view ? 1 : 0, p.can_create ? 1 : 0, p.can_edit ? 1 : 0, p.can_delete ? 1 : 0]
      );
    }

    await conn.commit();

    res.json(await loadRolePermissions(req.params.id));
  } catch (err) {
    await conn.rollback();
    console.error('Update role permissions error:', err.message);
    res.status(500).json({ error: 'Failed to update permissions.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
