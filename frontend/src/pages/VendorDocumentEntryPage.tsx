import { useEffect, useRef, useState } from 'react';
import { apiClient, extractErrorMessage, openAuthenticatedFile } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useVendors } from '../components/VendorDocumentsSection';
import { VendorSelect } from '../components/VendorSelect';
import type { Patient } from '../types';

interface StandaloneVendorDocument {
  id: number;
  vendor_id: number;
  vendor_name: string;
  patient_uhid: string | null;
  patient_name: string | null;
  vendor_invoice_no: string | null;
  vendor_invoice_date: string | null;
  remarks: string | null;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  file_size: number;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

interface ListResponse {
  data: StandaloneVendorDocument[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function VendorDocumentEntryPage() {
  const { can } = useAuth();
  const vendors = useVendors();

  const canCreate = can('vendor_documents', 'create');
  const canEdit = can('vendor_documents', 'edit');
  const canDelete = can('vendor_documents', 'delete');

  // List state
  const [documents, setDocuments] = useState<StandaloneVendorDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filter state
  const [filterVendorId, setFilterVendorId] = useState<number | ''>('');
  const [filterVendorInvoiceNo, setFilterVendorInvoiceNo] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Patient fetch state (upload form)
  const [uhid, setUhid] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [fetchingPatient, setFetchingPatient] = useState(false);
  const [patientError, setPatientError] = useState<string | null>(null);

  // Upload form state
  const [vendorId, setVendorId] = useState<number | ''>('');
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('');
  const [vendorInvoiceDate, setVendorInvoiceDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Edit modal state
  const [editingDoc, setEditingDoc] = useState<StandaloneVendorDocument | null>(null);
  const [editVendorId, setEditVendorId] = useState<number | ''>('');
  const [editPatientUhid, setEditPatientUhid] = useState('');
  const [editPatientName, setEditPatientName] = useState('');
  const [editFetchingPatient, setEditFetchingPatient] = useState(false);
  const [editPatientError, setEditPatientError] = useState<string | null>(null);
  const [editVendorInvoiceNo, setEditVendorInvoiceNo] = useState('');
  const [editVendorInvoiceDate, setEditVendorInvoiceDate] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  const loadDocuments = async (p = 1) => {
    setLoading(true);
    setListError(null);
    try {
      const params: Record<string, string | number> = { page: p, limit: 20 };
      if (filterVendorId) params.vendor_id = filterVendorId;
      if (filterVendorInvoiceNo) params.vendor_invoice_no = filterVendorInvoiceNo;
      if (filterDateFrom) params.date_from = filterDateFrom;
      if (filterDateTo) params.date_to = filterDateTo;

      const { data } = await apiClient.get<ListResponse>('/standalone-vendor-documents', { params });
      setDocuments(data.data ?? []);
      setTotalPages(data.totalPages ?? 1);
      setPage(p);
    } catch (err) {
      setListError(extractErrorMessage(err, 'Failed to load vendor documents.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    loadDocuments(1);
  };

  const fetchPatient = async () => {
    if (!uhid.trim()) return;
    setFetchingPatient(true);
    setPatientError(null);
    setPatient(null);
    try {
      const { data } = await apiClient.get<Patient>(`/patients/${encodeURIComponent(uhid.trim())}`);
      setPatient(data);
    } catch (err) {
      setPatientError(extractErrorMessage(err, 'Patient not found.'));
    } finally {
      setFetchingPatient(false);
    }
  };

  const fetchEditPatient = async () => {
    if (!editPatientUhid.trim()) return;
    setEditFetchingPatient(true);
    setEditPatientError(null);
    try {
      const { data } = await apiClient.get<Patient>(`/patients/${encodeURIComponent(editPatientUhid.trim())}`);
      setEditPatientName(data.name || '');
    } catch (err) {
      setEditPatientError(extractErrorMessage(err, 'Patient not found.'));
    } finally {
      setEditFetchingPatient(false);
    }
  };

  const resetForm = () => {
    setUhid('');
    setPatient(null);
    setPatientError(null);
    setVendorId('');
    setVendorInvoiceNo('');
    setVendorInvoiceDate('');
    setRemarks('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorId || !file) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(false);
    try {
      const form = new FormData();
      form.append('vendor_id', String(vendorId));
      if (patient?.uhid) form.append('patient_uhid', patient.uhid);
      if (patient?.name) form.append('patient_name', patient.name);
      if (vendorInvoiceNo) form.append('vendor_invoice_no', vendorInvoiceNo);
      if (vendorInvoiceDate) form.append('vendor_invoice_date', vendorInvoiceDate);
      if (remarks) form.append('remarks', remarks);
      form.append('file', file);
      await apiClient.post('/standalone-vendor-documents', form);
      resetForm();
      setUploadSuccess(true);
      await loadDocuments(1);
    } catch (err) {
      setUploadError(extractErrorMessage(err, 'Failed to upload vendor document.'));
    } finally {
      setUploading(false);
    }
  };

  const handleViewFile = async (doc: StandaloneVendorDocument) => {
    try {
      await openAuthenticatedFile(`/standalone-vendor-documents/${doc.id}/file`);
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Failed to open file.'));
    }
  };

  const handleDelete = async (doc: StandaloneVendorDocument) => {
    if (!confirm(`Delete document "${doc.original_filename}"?`)) return;
    setActionError(null);
    try {
      await apiClient.delete(`/standalone-vendor-documents/${doc.id}`);
      await loadDocuments(page);
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Failed to delete vendor document.'));
    }
  };

  const openEdit = (doc: StandaloneVendorDocument) => {
    setEditingDoc(doc);
    setEditVendorId(doc.vendor_id);
    setEditPatientUhid(doc.patient_uhid || '');
    setEditPatientName(doc.patient_name || '');
    setEditVendorInvoiceNo(doc.vendor_invoice_no || '');
    setEditVendorInvoiceDate(doc.vendor_invoice_date || '');
    setEditRemarks(doc.remarks || '');
    setEditFile(null);
    setEditError(null);
    setEditPatientError(null);
  };

  const closeEdit = () => {
    setEditingDoc(null);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingDoc || !editVendorId) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const form = new FormData();
      form.append('vendor_id', String(editVendorId));
      if (editPatientUhid) form.append('patient_uhid', editPatientUhid);
      if (editPatientName) form.append('patient_name', editPatientName);
      if (editVendorInvoiceNo) form.append('vendor_invoice_no', editVendorInvoiceNo);
      if (editVendorInvoiceDate) form.append('vendor_invoice_date', editVendorInvoiceDate);
      if (editRemarks) form.append('remarks', editRemarks);
      if (editFile) form.append('file', editFile);
      await apiClient.put(`/standalone-vendor-documents/${editingDoc.id}`, form);
      setEditingDoc(null);
      await loadDocuments(page);
    } catch (err) {
      setEditError(extractErrorMessage(err, 'Failed to update vendor document.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const showActionsColumn = canEdit || canDelete;

  return (
    <div className="page">
      <h1>Vendor Document Entry</h1>

      {/* Upload Form */}
      {canCreate && (
        <section className="card">
          <h2>Add Vendor Document</h2>
          {uploadError && <div className="alert alert-error">{uploadError}</div>}
          {uploadSuccess && <div className="alert alert-success">Document uploaded successfully.</div>}
          <form onSubmit={handleUpload}>
            <div className="vde-form-grid">
              {/* Row 1: Patient UHID (2 cols) + Patient Name (2 cols) */}
              <label className="vde-uhid-label">
                Patient UHID
                <div className="uhid-row">
                  <input
                    type="text"
                    value={uhid}
                    onChange={(e) => { setUhid(e.target.value); setPatient(null); setPatientError(null); }}
                    placeholder="Scan or enter UHID"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), fetchPatient())}
                  />
                  <button type="button" onClick={fetchPatient} disabled={fetchingPatient || !uhid.trim()}>
                    {fetchingPatient ? 'Fetching...' : 'Fetch'}
                  </button>
                </div>
                {patientError && <span className="field-error">{patientError}</span>}
              </label>
              <label className="vde-patient-name-label">
                Patient Name
                <input
                  type="text"
                  value={patient?.name || ''}
                  readOnly
                  placeholder="Auto-filled from UHID"
                  className="input-readonly"
                />
                {patient && (
                  <span className="patient-uhid-badge">{patient.uhid}</span>
                )}
              </label>

              {/* Row 2: Vendor + Invoice No + Invoice Date + Remarks */}
              <label>
                Vendor <span className="req">*</span>
                <VendorSelect
                  vendors={vendors}
                  value={vendorId}
                  onChange={setVendorId}
                  placeholder="Search vendor..."
                  required
                />
              </label>
              <label>
                Vendor Invoice No.
                <input
                  type="text"
                  value={vendorInvoiceNo}
                  onChange={(e) => setVendorInvoiceNo(e.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label>
                Vendor Invoice Date
                <input
                  type="date"
                  value={vendorInvoiceDate}
                  onChange={(e) => setVendorInvoiceDate(e.target.value)}
                />
              </label>
              <label>
                Remarks
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="vde-file-label">
                Document File <span className="req">*</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  ref={fileInputRef}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  required
                />
                <small className="field-hint">PDF, JPEG, or PNG · Max 10 MB</small>
              </label>
              <div className="vde-submit-cell">
                <button type="submit" disabled={uploading || !vendorId || !file}>
                  {uploading ? 'Uploading...' : 'Upload Document'}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      {/* Filter + Table */}
      <section className="card">
        <h2>Vendor Documents</h2>
        <form onSubmit={handleFilter}>
          <div className="vde-filter-bar">
            <label>
              Vendor
              <VendorSelect
                vendors={vendors}
                value={filterVendorId}
                onChange={setFilterVendorId}
                placeholder="All vendors..."
              />
            </label>
            <label>
              Vendor Invoice No.
              <input
                type="text"
                value={filterVendorInvoiceNo}
                onChange={(e) => setFilterVendorInvoiceNo(e.target.value)}
                placeholder="Search..."
              />
            </label>
            <label>
              From
              <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
            </label>
            <button type="submit" className="vde-search-btn">Search</button>
          </div>
        </form>

        {actionError && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{actionError}</div>}

        {loading ? (
          <p style={{ marginTop: '1rem' }}>Loading...</p>
        ) : listError ? (
          <div className="alert alert-error" style={{ marginTop: '1rem' }}>{listError}</div>
        ) : (
          <>
            <table className="data-table vde-table">
              <thead>
                <tr>
                  <th className="col-no">#</th>
                  <th className="col-patient">Patient</th>
                  <th className="col-vendor">Vendor</th>
                  <th className="col-inv-no">Invoice No.</th>
                  <th className="col-date">Invoice Date</th>
                  <th className="col-remarks">Remarks</th>
                  <th className="col-file">File</th>
                  <th className="col-upby">Uploaded By</th>
                  <th className="col-upat">Uploaded At</th>
                  {showActionsColumn && <th className="col-actions"></th>}
                </tr>
              </thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={showActionsColumn ? 10 : 9} className="empty-row">
                      No vendor documents found.
                    </td>
                  </tr>
                ) : (
                  documents.map((doc, i) => (
                    <tr key={doc.id}>
                      <td className="col-no">{(page - 1) * 20 + i + 1}</td>
                      <td className="col-patient">
                        {doc.patient_name ? (
                          <>
                            <span className="patient-name">{doc.patient_name}</span>
                            <span className="patient-id">{doc.patient_uhid}</span>
                          </>
                        ) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                      </td>
                      <td className="col-vendor">{doc.vendor_name}</td>
                      <td className="col-inv-no">{doc.vendor_invoice_no || '-'}</td>
                      <td className="col-date">{doc.vendor_invoice_date || '-'}</td>
                      <td className="col-remarks">{doc.remarks || '-'}</td>
                      <td className="col-file">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => handleViewFile(doc)}
                          title={doc.original_filename}
                        >
                          {doc.original_filename}
                        </button>
                      </td>
                      <td className="col-upby">{doc.uploaded_by_name || '-'}</td>
                      <td className="col-upat">{doc.uploaded_at}</td>
                      {showActionsColumn && (
                        <td className="col-actions table-actions">
                          {canEdit && (
                            <button type="button" onClick={() => openEdit(doc)}>Edit</button>
                          )}
                          {canDelete && (
                            <button type="button" className="btn-danger" onClick={() => handleDelete(doc)}>
                              Delete
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="pagination" style={{ marginTop: '1rem' }}>
                <button type="button" disabled={page <= 1} onClick={() => loadDocuments(page - 1)}>Previous</button>
                <span>Page {page} of {totalPages}</span>
                <button type="button" disabled={page >= totalPages} onClick={() => loadDocuments(page + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Edit Modal */}
      {editingDoc && (
        <div className="modal-backdrop" onClick={closeEdit}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Vendor Document</h2>
            {editError && <div className="alert alert-error">{editError}</div>}
            <div className="vde-edit-grid">
              {/* Row 1: Patient UHID + Patient Name */}
              <label className="vde-edit-uhid">
                Patient UHID
                <div className="uhid-row">
                  <input
                    value={editPatientUhid}
                    onChange={(e) => setEditPatientUhid(e.target.value)}
                    placeholder="Enter UHID"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), fetchEditPatient())}
                  />
                  <button type="button" onClick={fetchEditPatient} disabled={editFetchingPatient || !editPatientUhid.trim()}>
                    {editFetchingPatient ? '...' : 'Fetch'}
                  </button>
                </div>
                {editPatientError && <span className="field-error">{editPatientError}</span>}
              </label>
              <label className="vde-edit-pname">
                Patient Name
                <input value={editPatientName} onChange={(e) => setEditPatientName(e.target.value)} className="input-readonly" readOnly />
              </label>

              {/* Row 2: Vendor + Invoice No */}
              <label>
                Vendor
                <VendorSelect
                  vendors={vendors}
                  value={editVendorId}
                  onChange={setEditVendorId}
                  placeholder="Search vendor..."
                />
              </label>
              <label>
                Vendor Invoice No.
                <input
                  value={editVendorInvoiceNo}
                  onChange={(e) => setEditVendorInvoiceNo(e.target.value)}
                />
              </label>

              {/* Row 3: Invoice Date + Remarks */}
              <label>
                Vendor Invoice Date
                <input
                  type="date"
                  value={editVendorInvoiceDate}
                  onChange={(e) => setEditVendorInvoiceDate(e.target.value)}
                />
              </label>
              <label>
                Remarks
                <input
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                />
              </label>

              {/* Row 4: Replace File (full width) */}
              <label className="vde-edit-file">
                Replace File (optional)
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={(e) => setEditFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button onClick={closeEdit} className="btn-secondary" type="button">Cancel</button>
              <button onClick={handleSaveEdit} disabled={savingEdit || !editVendorId} type="button">
                {savingEdit ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
