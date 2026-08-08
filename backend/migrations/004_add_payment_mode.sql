-- Fields needed for the HIS-style printed cash bill: payment mode, department,
-- and a patient address snapshot (HIS admission lookup doesn't supply address).
ALTER TABLE invoices
  ADD COLUMN payment_mode ENUM('Credit', 'Cash', 'Card', 'UPI', 'Insurance', 'Cheque') NOT NULL DEFAULT 'Credit' AFTER doctor_name,
  ADD COLUMN department VARCHAR(150) NULL AFTER payment_mode,
  ADD COLUMN patient_address VARCHAR(500) NULL AFTER patient_mobile;
