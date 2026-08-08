const express = require('express');
const pool = require('../db/mysql');
const { requireAuth, requirePermission } = require('../middleware/auth');

// Shared CRUD for simple admin-managed lookup tables (categories, units,
// vendors): a single `name` column plus is_active. All authenticated roles can
// read; writes are gated by the RBAC permission matrix for `screen` (defaults
// to itemLabel + 's', e.g. itemLabel 'category' -> screen 'categories').
// Delete is blocked while any row in `referencedByTable` (default: items)
// still references this row via `fkColumn`.
function makeMasterRouter({ table, fkColumn, itemLabel, referencedByTable = 'items', screen }) {
  const permissionScreen = screen || `${itemLabel}s`;
  const router = express.Router();

  router.use(requireAuth);

  router.get('/', requirePermission(permissionScreen, 'view'), async (req, res) => {
    const { activeOnly } = req.query;
    let sql = `SELECT * FROM ${table}`;
    if (activeOnly === 'true') {
      sql += ' WHERE is_active = 1';
    }
    sql += ' ORDER BY name ASC';

    try {
      const [rows] = await pool.query(sql);
      res.json(rows);
    } catch (err) {
      console.error(`List ${table} error:`, err.message);
      res.status(500).json({ error: `Failed to fetch ${itemLabel}s.` });
    }
  });

  router.post('/', requirePermission(permissionScreen, 'create'), async (req, res) => {
    const { name, is_active } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required.' });
    }

    try {
      const [result] = await pool.query(
        `INSERT INTO ${table} (name, is_active) VALUES (?, ?)`,
        [name.trim(), is_active === undefined ? 1 : is_active ? 1 : 0]
      );
      const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: `A ${itemLabel} named '${name}' already exists.` });
      }
      console.error(`Create ${table} error:`, err.message);
      res.status(500).json({ error: `Failed to create ${itemLabel}.` });
    }
  });

  router.put('/:id', requirePermission(permissionScreen, 'edit'), async (req, res) => {
    const { name, is_active } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required.' });
    }

    try {
      const [beforeRows] = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (beforeRows.length === 0) {
        return res.status(404).json({ error: `${itemLabel} not found.` });
      }
      req.auditBefore = beforeRows[0];

      const [result] = await pool.query(
        `UPDATE ${table} SET name = ?, is_active = ? WHERE id = ?`,
        [name.trim(), is_active ? 1 : 0, req.params.id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: `${itemLabel} not found.` });
      }
      const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      res.json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: `A ${itemLabel} named '${name}' already exists.` });
      }
      console.error(`Update ${table} error:`, err.message);
      res.status(500).json({ error: `Failed to update ${itemLabel}.` });
    }
  });

  router.delete('/:id', requirePermission(permissionScreen, 'delete'), async (req, res) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: `${itemLabel} not found.` });
      }

      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) AS count FROM ${referencedByTable} WHERE ${fkColumn} = ?`,
        [req.params.id]
      );

      if (count > 0) {
        return res.status(409).json({
          error: `Cannot delete '${rows[0].name}' — ${count} item(s) use this ${itemLabel}.`,
        });
      }

      req.auditBefore = rows[0];

      await pool.query(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
      res.status(204).send();
    } catch (err) {
      console.error(`Delete ${table} error:`, err.message);
      res.status(500).json({ error: `Failed to delete ${itemLabel}.` });
    }
  });

  return router;
}

module.exports = makeMasterRouter;
