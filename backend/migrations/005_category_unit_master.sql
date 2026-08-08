-- Category and Unit become real admin-managed master tables instead of a
-- hardcoded list, matching the Item Master pattern.
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS units (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed with the same values the old hardcoded lists used, so nothing changes
-- for existing data or the dropdowns' initial contents.
INSERT INTO categories (name) VALUES
  ('Orthopedic'), ('Cardiac'), ('Dental'), ('Spinal'), ('General')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO units (name) VALUES
  ('BOX'), ('PIECE'), ('PACK'), ('SET'), ('VIAL')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Add FK columns to items, backfill from the existing free-text values, then
-- drop the old text columns. Any item whose category/unit text doesn't match a
-- seeded master row (e.g. a typo or a value outside the original 5/5 lists)
-- backfills to NULL rather than failing the migration — those items will need
-- their category/unit re-selected via the Item Master UI after this runs.
ALTER TABLE items
  ADD COLUMN category_id INT NULL AFTER category,
  ADD COLUMN unit_id INT NULL AFTER unit;

UPDATE items i
  JOIN categories c ON c.name = i.category
  SET i.category_id = c.id;

UPDATE items i
  JOIN units u ON u.name = i.unit
  SET i.unit_id = u.id;

ALTER TABLE items
  DROP COLUMN category,
  DROP COLUMN unit,
  ADD CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES categories(id),
  ADD CONSTRAINT fk_items_unit FOREIGN KEY (unit_id) REFERENCES units(id);
