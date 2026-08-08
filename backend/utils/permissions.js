const pool = require('../db/mysql');

// Returns { [screen]: { can_view, can_create, can_edit, can_delete } } for a
// role. Screens with no row default to all-false rather than being omitted,
// so requirePermission's lookup never has to special-case "missing screen".
async function loadRolePermissions(roleId) {
  const [rows] = await pool.query(
    'SELECT screen, can_view, can_create, can_edit, can_delete FROM role_permissions WHERE role_id = ?',
    [roleId]
  );

  const permissions = {};
  for (const row of rows) {
    permissions[row.screen] = {
      can_view: !!row.can_view,
      can_create: !!row.can_create,
      can_edit: !!row.can_edit,
      can_delete: !!row.can_delete,
    };
  }
  return permissions;
}

module.exports = { loadRolePermissions };
