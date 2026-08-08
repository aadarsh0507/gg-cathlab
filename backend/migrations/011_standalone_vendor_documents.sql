-- Standalone vendor documents not tied to any invoice.
-- Staff can upload scanned vendor invoices/delivery notes independently.
CREATE TABLE IF NOT EXISTS standalone_vendor_documents (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id       INT NOT NULL,
  vendor_invoice_no   VARCHAR(100),
  vendor_invoice_date DATE,
  remarks         VARCHAR(500),
  original_filename   VARCHAR(255) NOT NULL,
  stored_filename     VARCHAR(255) NOT NULL,
  mime_type           VARCHAR(100) NOT NULL,
  file_size           INT NOT NULL,
  uploaded_by     INT,
  uploaded_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_svd_vendor     FOREIGN KEY (vendor_id)    REFERENCES vendors(id),
  CONSTRAINT fk_svd_uploader   FOREIGN KEY (uploaded_by)  REFERENCES users(id),
  INDEX idx_svd_vendor     (vendor_id),
  INDEX idx_svd_uploaded   (uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
