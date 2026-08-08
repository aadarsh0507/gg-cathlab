-- Approval Master: an admin-managed ordered sequence of named approval steps
-- (e.g. "Billing Supervisor" -> "Finance Manager"). Every invoice, once
-- created, must pass every level in order before it's considered approved.
CREATE TABLE IF NOT EXISTS approval_levels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  sequence_order INT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_approval_levels_sequence (sequence_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Which users are allowed to approve at each level. A level can have multiple
-- assigned users; any one of them approving satisfies that level.
CREATE TABLE IF NOT EXISTS approval_level_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  approval_level_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_alu_level FOREIGN KEY (approval_level_id) REFERENCES approval_levels(id) ON DELETE CASCADE,
  CONSTRAINT fk_alu_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE INDEX uq_alu_level_user (approval_level_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-invoice, per-level tracking. One row per (invoice, level) pair, seeded
-- as 'pending' for every active level when the invoice is created.
CREATE TABLE IF NOT EXISTS invoice_approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  approval_level_id INT NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  acted_by INT,
  acted_at DATETIME,
  remarks VARCHAR(500),
  CONSTRAINT fk_ia_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_ia_level FOREIGN KEY (approval_level_id) REFERENCES approval_levels(id),
  CONSTRAINT fk_ia_acted_by FOREIGN KEY (acted_by) REFERENCES users(id),
  UNIQUE INDEX uq_ia_invoice_level (invoice_id, approval_level_id),
  INDEX idx_ia_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Overall rollup on the invoice itself, so list/detail views don't need to
-- join+aggregate invoice_approvals just to show a status badge. Kept in sync
-- by the application layer whenever an invoice_approvals row changes.
ALTER TABLE invoices
  ADD COLUMN approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending' AFTER status;
