-- Add field-level before/after diff storage to the audit log, so entries can
-- show what actually changed on an update, not just that one occurred.
ALTER TABLE audit_log ADD COLUMN details JSON NULL AFTER record_id;
