-- Audit log: who did what, when, on which screen. No field-level diffs —
-- just user, timestamp, screen, action, and the affected record id.
CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  username VARCHAR(100) NOT NULL,
  screen VARCHAR(50) NOT NULL,
  action ENUM('create', 'update', 'delete') NOT NULL,
  record_id VARCHAR(50) NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_log_created_at (created_at),
  INDEX idx_audit_log_screen (screen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Register the new "audit_log" screen and grant the built-in admin role full
-- view access to it (create/edit/delete are meaningless for a log — never
-- granted to anyone, including admin, since log entries are system-written).
INSERT INTO role_permissions (role_id, screen, can_view, can_create, can_edit, can_delete)
SELECT r.id, 'audit_log', 1, 0, 0, 0
FROM roles r
WHERE r.name = 'admin'
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view);
