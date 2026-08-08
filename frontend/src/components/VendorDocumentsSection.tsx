import { useEffect, useState } from 'react';
import { apiClient, extractErrorMessage, openAuthenticatedFile } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { MasterOption, VendorDocument } from '../types';

export interface StagedVendorDocument {
  key: number;
  vendorId: number;
  vendorName: string;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string;
  file: File;
}

interface BaseProps {
  vendors: MasterOption[];
}

interface UploadModeProps extends BaseProps {
  mode: 'upload';
  invoiceId: number;
  documents: VendorDocument[];
  onChanged: () => void;
}

interface StageModeProps extends BaseProps {
  mode: 'stage';
  staged: StagedVendorDocument[];
  onStagedChange: (staged: StagedVendorDocument[]) => void;
}

type VendorDocumentsSectionProps = UploadModeProps | StageModeProps;

let stageKeySeq = 1;

export function useVendors(): MasterOption[] {
  const [vendors, setVendors] = useState<MasterOption[]>([]);
  useEffect(() => {
    apiClient
      .get<MasterOption[]>('/vendors')
      .then(({ data }) => setVendors(data))
      .catch(() => setVendors([]));
  }, []);
  return vendors;
}

export function VendorDocumentsSection(props: VendorDocumentsSectionProps) {
  const { vendors } = props;
  const { can } = useAuth();
  const canEdit = can('vendor_documents', 'edit');
  const canDelete = can('vendor_documents', 'delete');
  const showActionsColumn = props.mode === 'stage' || canEdit || canDelete;

  const [vendorId, setVendorId] = useState<number | ''>('');
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('');
  const [vendorInvoiceDate, setVendorInvoiceDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editingDoc, setEditingDoc] = useState<VendorDocument | null>(null);
  const [editVendorId, setEditVendorId] = useState<number | ''>('');
  const [editVendorInvoiceNo, setEditVendorInvoiceNo] = useState('');
  const [editVendorInvoiceDate, setEditVendorInvoiceDate] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const resetForm = () => {
    setVendorId('');
    setVendorInvoiceNo('');
    setVendorInvoiceDate('');
    setFile(null);
  };

  const handleAdd = async () => {
    if (!file || !vendorId) return;
    setActionError(null);

    if (props.mode === 'stage') {
      const vendor = vendors.find((v) => v.id === vendorId);
      props.onStagedChange([
        ...props.staged,
        {
          key: stageKeySeq++,
          vendorId,
          vendorName: vendor?.name || '',
          vendorInvoiceNo,
          vendorInvoiceDate,
          file,
        },
      ]);
      resetForm();
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('vendor_id', String(vendorId));
      if (vendorInvoiceNo) form.append('vendor_invoice_no', vendorInvoiceNo);
      if (vendorInvoiceDate) form.append('vendor_invoice_date', vendorInvoiceDate);
      form.append('file', file);

      await apiClient.post(`/invoices/${props.invoiceId}/vendor-documents`, form);

      resetForm();
      props.onChanged();
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Failed to upload vendor document.'));
    } finally {
      setUploading(false);
    }
  };

  const handleViewFile = async (invoiceId: number, docId: number) => {
    try {
      await openAuthenticatedFile(`/invoices/${invoiceId}/vendor-documents/${docId}/file`);
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Failed to open file.'));
    }
  };

  const handleDeleteDoc = async (invoiceId: number, docId: number) => {
    if (!confirm('Delete this vendor document?')) return;
    try {
      await apiClient.delete(`/invoices/${invoiceId}/vendor-documents/${docId}`);
      if (props.mode === 'upload') props.onChanged();
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Failed to delete vendor document.'));
    }
  };

  const removeStaged = (key: number) => {
    if (props.mode !== 'stage') return;
    props.onStagedChange(props.staged.filter((s) => s.key !== key));
  };

  const openEdit = (doc: VendorDocument) => {
    setEditingDoc(doc);
    setEditVendorId(doc.vendor_id);
    setEditVendorInvoiceNo(doc.vendor_invoice_no || '');
    setEditVendorInvoiceDate(doc.vendor_invoice_date || '');
    setEditFile(null);
    setEditError(null);
  };

  const closeEdit = () => {
    setEditingDoc(null);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingDoc || props.mode !== 'upload' || !editVendorId) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const form = new FormData();
      form.append('vendor_id', String(editVendorId));
      if (editVendorInvoiceNo) form.append('vendor_invoice_no', editVendorInvoiceNo);
      if (editVendorInvoiceDate) form.append('vendor_invoice_date', editVendorInvoiceDate);
      if (editFile) form.append('file', editFile);

      await apiClient.put(`/invoices/${props.invoiceId}/vendor-documents/${editingDoc.id}`, form);

      setEditingDoc(null);
      props.onChanged();
    } catch (err) {
      setEditError(extractErrorMessage(err, 'Failed to update vendor document.'));
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <section className="card no-print">
      <h3>Vendor Documents</h3>

      {actionError && <div className="alert alert-error">{actionError}</div>}

      <div className="inline-form">
        <label>
          Vendor
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Select vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vendor Invoice No.
          <input value={vendorInvoiceNo} onChange={(e) => setVendorInvoiceNo(e.target.value)} />
        </label>
        <label>
          Vendor Invoice Date
          <input type="date" value={vendorInvoiceDate} onChange={(e) => setVendorInvoiceDate(e.target.value)} />
        </label>
        <label>
          File
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <button onClick={handleAdd} disabled={uploading || !file || !vendorId} type="button">
          {props.mode === 'stage' ? 'Add' : uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Vendor Invoice No.</th>
            <th>Vendor Invoice Date</th>
            <th>File</th>
            {props.mode === 'upload' && (
              <>
                <th>Uploaded By</th>
                <th>Uploaded At</th>
              </>
            )}
            {showActionsColumn && <th></th>}
          </tr>
        </thead>
        <tbody>
          {props.mode === 'stage'
            ? props.staged.map((doc) => (
                <tr key={doc.key}>
                  <td>{doc.vendorName}</td>
                  <td>{doc.vendorInvoiceNo || '-'}</td>
                  <td>{doc.vendorInvoiceDate || '-'}</td>
                  <td>{doc.file.name}</td>
                  <td>
                    <button type="button" className="btn-danger" onClick={() => removeStaged(doc.key)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            : props.documents.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.vendor_name}</td>
                  <td>{doc.vendor_invoice_no || '-'}</td>
                  <td>{doc.vendor_invoice_date || '-'}</td>
                  <td>
                    <button type="button" className="link-button" onClick={() => handleViewFile(props.invoiceId, doc.id)}>
                      {doc.original_filename}
                    </button>
                  </td>
                  <td>{doc.uploaded_by_name || '-'}</td>
                  <td>{doc.uploaded_at}</td>
                  {showActionsColumn && (
                    <td className="table-actions">
                      {canEdit && (
                        <button type="button" onClick={() => openEdit(doc)}>
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" className="btn-danger" onClick={() => handleDeleteDoc(props.invoiceId, doc.id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
          {props.mode === 'stage' && props.staged.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-row">
                No documents attached yet. They'll be uploaded once the invoice is created.
              </td>
            </tr>
          )}
          {props.mode === 'upload' && props.documents.length === 0 && (
            <tr>
              <td colSpan={showActionsColumn ? 7 : 6} className="empty-row">
                No vendor documents uploaded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editingDoc && props.mode === 'upload' && (
        <div className="modal-backdrop" onClick={closeEdit}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Vendor Document</h2>

            {editError && <div className="alert alert-error">{editError}</div>}

            <div className="form-grid">
              <label>
                Vendor
                <select
                  value={editVendorId}
                  onChange={(e) => setEditVendorId(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">Select vendor</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Vendor Invoice No.
                <input value={editVendorInvoiceNo} onChange={(e) => setEditVendorInvoiceNo(e.target.value)} />
              </label>
              <label>
                Vendor Invoice Date
                <input
                  type="date"
                  value={editVendorInvoiceDate}
                  onChange={(e) => setEditVendorInvoiceDate(e.target.value)}
                />
              </label>
              <label>
                Replace File (optional)
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={(e) => setEditFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button onClick={closeEdit} className="btn-secondary" type="button">
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={savingEdit || !editVendorId} type="button">
                {savingEdit ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
