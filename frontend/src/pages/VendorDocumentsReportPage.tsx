import { useEffect, useState } from 'react';
import { apiClient, extractErrorMessage, openAuthenticatedFile } from '../api/client';
import { Pagination } from '../components/Pagination';
import type { MasterOption } from '../types';

interface StandaloneDoc {
  id: number;
  vendor_id: number;
  vendor_name: string;
  patient_uhid: string | null;
  patient_name: string | null;
  vendor_invoice_no: string | null;
  vendor_invoice_date: string | null;
  remarks: string | null;
  original_filename: string;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

interface ReportResponse {
  data: StandaloneDoc[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function VendorDocumentsReportPage() {
  const [rows, setRows] = useState<StandaloneDoc[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vendors, setVendors] = useState<MasterOption[]>([]);
  const [patientUhid, setPatientUhid] = useState('');
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('');
  const [vendorId, setVendorId] = useState<number | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    apiClient
      .get<MasterOption[]>('/vendors')
      .then(({ data }) => setVendors(data))
      .catch(() => setVendors([]));
  }, []);

  const load = async (targetPage = 1) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<ReportResponse>('/standalone-vendor-documents', {
        params: {
          page: targetPage,
          limit: 20,
          vendor_id: vendorId || undefined,
          vendor_invoice_no: vendorInvoiceNo || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        },
      });
      setRows(data.data);
      setPage(data.page);
      setTotal(data.total);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load vendor documents.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    load(1);
  };

  const handleViewFile = async (doc: StandaloneDoc) => {
    try {
      await openAuthenticatedFile(`/standalone-vendor-documents/${doc.id}/file`);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to open file.'));
    }
  };

  return (
    <div className="page">
      <h1>Vendor Documents</h1>

      <form className="filter-bar" onSubmit={handleFilter}>
        <input
          placeholder="Patient UHID"
          value={patientUhid}
          onChange={(e) => setPatientUhid(e.target.value)}
        />
        <input
          placeholder="Vendor Invoice No."
          value={vendorInvoiceNo}
          onChange={(e) => setVendorInvoiceNo(e.target.value)}
        />
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <button type="submit">Search</button>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          {total > 0 && (
            <p className="report-count">{total} document{total !== 1 ? 's' : ''} found</p>
          )}
          <table className="data-table vdr-table">
            <thead>
              <tr>
                <th className="vdr-no">#</th>
                <th className="vdr-patient">Patient</th>
                <th className="vdr-vendor">Vendor</th>
                <th className="vdr-inv-no">Vendor Invoice No.</th>
                <th className="vdr-inv-date">Invoice Date</th>
                <th className="vdr-remarks">Remarks</th>
                <th className="vdr-file">File</th>
                <th className="vdr-upby">Uploaded By</th>
                <th className="vdr-upat">Uploaded At</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-row">
                    No vendor documents found for these filters.
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={row.id}>
                    <td className="vdr-no">{(page - 1) * 20 + i + 1}</td>
                    <td className="vdr-patient">
                      {row.patient_name ? (
                        <>
                          <span className="patient-name">{row.patient_name}</span>
                          <span className="patient-id">{row.patient_uhid}</span>
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)' }}>—</span>
                      )}
                    </td>
                    <td className="vdr-vendor">{row.vendor_name}</td>
                    <td className="vdr-inv-no">{row.vendor_invoice_no || '—'}</td>
                    <td className="vdr-inv-date">{row.vendor_invoice_date || '—'}</td>
                    <td className="vdr-remarks">{row.remarks || '—'}</td>
                    <td className="vdr-file">
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleViewFile(row)}
                        title={row.original_filename}
                      >
                        {row.original_filename}
                      </button>
                    </td>
                    <td className="vdr-upby">{row.uploaded_by_name || '—'}</td>
                    <td className="vdr-upat">{row.uploaded_at}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={load} />
        </>
      )}
    </div>
  );
}
