-- Enforce case-insensitive-unique item names at the DB level (app layer also
-- checks this first to return a friendly 409 instead of a raw constraint error).
-- item_name uses the table's default collation (utf8mb4_general_ci / *_0900_ai_ci
-- depending on server version), both of which are case-insensitive, so a plain
-- UNIQUE index is sufficient without a generated lowercase column.
ALTER TABLE items
  ADD UNIQUE INDEX uq_item_name (item_name);

-- Dedicated counter table for auto-generated item codes (IMP-001, IMP-002, ...),
-- locked the same way invoice_sequences is locked for invoice_no generation.
CREATE TABLE IF NOT EXISTS item_sequences (
  id INT PRIMARY KEY DEFAULT 1,
  last_seq INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_item_sequences_single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO item_sequences (id, last_seq)
SELECT 1, COALESCE(MAX(CAST(SUBSTRING_INDEX(item_code, '-', -1) AS UNSIGNED)), 0)
FROM items
WHERE item_code REGEXP '^IMP-[0-9]+$'
ON DUPLICATE KEY UPDATE last_seq = VALUES(last_seq);
