-- Full RBAC: dynamic roles (replacing the hardcoded admin/billing_staff ENUM)
-- with a per-screen, per-action permission matrix.

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255),
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per (role, screen): four boolean flags for view/create/edit/delete.
-- `screen` is a fixed key from the app's screen registry (backend/constants/screens.js),
-- not a free-text field — enforced at the application layer, not a DB FK, since
-- screens are a code-level concept (they map to route/resource groups), not data.
CREATE TABLE IF NOT EXISTS role_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id INT NOT NULL,
  screen VARCHAR(50) NOT NULL,
  can_view TINYINT(1) NOT NULL DEFAULT 0,
  can_create TINYINT(1) NOT NULL DEFAULT 0,
  can_edit TINYINT(1) NOT NULL DEFAULT 0,
  can_delete TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE INDEX uq_role_permissions_role_screen (role_id, screen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed the two existing roles so current logins keep working after the cutover.
INSERT INTO roles (name, description) VALUES
  ('admin', 'Full system access (migrated from the original admin role).'),
  ('billing_staff', 'Billing desk access (migrated from the original billing_staff role).')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- admin: full view/create/edit/delete on every screen.
INSERT INTO role_permissions (role_id, screen, can_view, can_create, can_edit, can_delete)
SELECT r.id, s.screen, 1, 1, 1, 1
FROM roles r
CROSS JOIN (
  SELECT 'items' AS screen UNION ALL SELECT 'invoices' UNION ALL SELECT 'users' UNION ALL
  SELECT 'roles' UNION ALL SELECT 'categories' UNION ALL SELECT 'units' UNION ALL
  SELECT 'vendors' UNION ALL SELECT 'vendor_documents' UNION ALL SELECT 'approval_levels' UNION ALL
  SELECT 'reports'
) s
WHERE r.name = 'admin'
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_create = VALUES(can_create),
  can_edit = VALUES(can_edit), can_delete = VALUES(can_delete);

-- billing_staff: matches its previous effective access — view everything,
-- create/edit invoices and vendor documents, but no management screens (users,
-- roles, approval_levels) and no deletes. categories/units/vendors are
-- view-only here since Item Master and the vendor-document upload form need
-- those dropdowns even though billing_staff can't manage the master lists.
INSERT INTO role_permissions (role_id, screen, can_view, can_create, can_edit, can_delete)
SELECT r.id, s.screen, s.can_view, s.can_create, s.can_edit, 0
FROM roles r
CROSS JOIN (
  SELECT 'items' AS screen, 1 AS can_view, 0 AS can_create, 0 AS can_edit UNION ALL
  SELECT 'invoices', 1, 1, 1 UNION ALL
  SELECT 'vendor_documents', 1, 1, 0 UNION ALL
  SELECT 'reports', 1, 0, 0 UNION ALL
  SELECT 'categories', 1, 0, 0 UNION ALL
  SELECT 'units', 1, 0, 0 UNION ALL
  SELECT 'vendors', 1, 0, 0
) s
WHERE r.name = 'billing_staff'
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_create = VALUES(can_create),
  can_edit = VALUES(can_edit), can_delete = VALUES(can_delete);

-- Migrate users.role (ENUM) to users.role_id (FK), backfilling from the
-- existing enum value, then drop the old column.
ALTER TABLE users
  ADD COLUMN role_id INT NULL AFTER role;

UPDATE users u
  JOIN roles r ON r.name = u.role
  SET u.role_id = r.id;

ALTER TABLE users
  MODIFY COLUMN role_id INT NOT NULL,
  ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id),
  DROP COLUMN role;
