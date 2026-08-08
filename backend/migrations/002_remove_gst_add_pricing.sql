-- items: drop GST/HSN fields, replace unit_price with purchase_cost + mrp
ALTER TABLE items
  ADD COLUMN purchase_cost DECIMAL(12,2) NULL AFTER category,
  ADD COLUMN mrp DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER purchase_cost;

UPDATE items SET mrp = unit_price;

ALTER TABLE items
  DROP COLUMN hsn_code,
  DROP COLUMN gst_percent,
  DROP COLUMN unit_price;

-- invoices: drop GST type + tax amount columns (no tax billing to patients anymore)
ALTER TABLE invoices
  DROP COLUMN gst_type,
  DROP COLUMN cgst_amount,
  DROP COLUMN sgst_amount,
  DROP COLUMN igst_amount;

-- invoice_items: drop HSN snapshot + GST/tax columns, rename unit_price -> mrp
ALTER TABLE invoice_items
  ADD COLUMN mrp DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER quantity;

UPDATE invoice_items SET mrp = unit_price;

ALTER TABLE invoice_items
  DROP COLUMN hsn_code,
  DROP COLUMN unit_price,
  DROP COLUMN gst_percent,
  DROP COLUMN cgst_amount,
  DROP COLUMN sgst_amount,
  DROP COLUMN igst_amount;
