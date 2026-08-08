import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, extractErrorMessage } from '../api/client';
import { Pagination } from '../components/Pagination';

interface InvoiceReportRow {
  id: number;
  invoice_no: string;
  patient_uhid: string;
  patient_name: string;
  invoice_date: string;
  total_amount: number;
  payment_mode: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

interface ReportResponse {
  data: InvoiceReportRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  grandTotal: number;
}

const APPROVAL_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const PAYMENT_OPTIONS = [
  { value: '', label: 'All modes' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Card', label: 'Card' },
  { value: 'UPI', label: 'UPI' },
  { value: 'Insurance', label: 'Insurance' },
  { value: 'Credit', label: 'Credit' },
];

function fmt(amount: number) {
  return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function InvoiceReportPage() {
  const [rows, setRows] = useState<InvoiceReportRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [invoiceNo, setInvoiceNo] = useState('');
  const [patientUhid, setPatientUhid] = useState('');
  const [patientName, setPatientName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');
  const [paymentMode, setPaymentMode] = useState('');

  const load = async (targetPage = 1) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<ReportResponse>('/invoices', {
        params: {
          page: targetPage,
          pageSize: 20,
          invoice_no: invoiceNo || undefined,
          patient_uhid: patientUhid || undefined,
          patient_name: patientName || undefined,
          from: dateFrom || undefined,
          to: dateTo || undefined,
          approval_status: approvalStatus || undefined,
          payment_mode: paymentMode || undefined,
        },
      });
      setRows(data.data);
      setPage(data.page);
      setTotal(data.total);
      setTotalPages(data.totalPages || 1);
      setGrandTotal(data.grandTotal ?? 0);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load invoices.'));
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

  const handleReset = () => {
    setInvoiceNo('');
    setPatientUhid('');
    setPatientName('');
    setDateFrom('');
    setDateTo('');
    setApprovalStatus('');
    setPaymentMode('');
    setTimeout(() => load(1), 0);
  };

  return (
    <div className="page">
      <h1>Invoice Report</h1>

      <section className="card">
        <form onSubmit={handleFilter}>
          <div className="inv-report-filters">
            <label>
              Invoice No.
              <input placeholder="Search..." value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </label>
            <label>
              Patient UHID
              <input placeholder="Search..." value={patientUhid} onChange={(e) => setPatientUhid(e.target.value)} />
            </label>
            <label>
              Patient Name
              <input placeholder="Search..." value={patientName} onChange={(e) => setPatientName(e.target.value)} />
            </label>
            <label>
              From
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label>
              Approval Status
              <select value={approvalStatus} onChange={(e) => setApprovalStatus(e.target.value)}>
                {APPROVAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label>
              Payment Mode
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                {PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <div className="inv-report-filter-actions">
              <button type="submit">Search</button>
              <button type="button" className="btn-secondary" onClick={handleReset}>Reset</button>
            </div>
          </div>
        </form>
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p style={{ marginTop: '1rem' }}>Loading...</p>
      ) : (
        <section className="card" style={{ marginTop: '1rem' }}>
          <div className="inv-report-summary">
            <span><strong>{total}</strong> invoice{total !== 1 ? 's' : ''}</span>
            <span>Total: <strong>{fmt(grandTotal)}</strong></span>
          </div>

          <table className="data-table inv-report-table">
            <thead>
              <tr>
                <th className="irc-no">#</th>
                <th className="irc-inv">Invoice No.</th>
                <th className="irc-date">Invoice Date</th>
                <th className="irc-date">Created Date</th>
                <th className="irc-patient">Patient</th>
                <th className="irc-uhid">UHID</th>
                <th className="irc-mode">Payment</th>
                <th className="irc-amount">Amount</th>
                <th className="irc-status">Approval</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-row">No invoices found for these filters.</td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={row.id}>
                    <td className="irc-no">{(page - 1) * 20 + i + 1}</td>
                    <td className="irc-inv">
                      <Link to={`/invoices/${row.id}`}>{row.invoice_no}</Link>
                    </td>
                    <td className="irc-date">{row.invoice_date ? row.invoice_date.slice(0,10) : '-'}</td>
                    <td className="irc-date">{row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') : '-'}</td>
                    <td className="irc-patient">{row.patient_name}</td>
                    <td className="irc-uhid">{row.patient_uhid}</td>
                    <td className="irc-mode">{row.payment_mode}</td>
                    <td className="irc-amount">{fmt(row.total_amount)}</td>
                    <td className="irc-status">
                      <span className={`approval-badge approval-badge-${row.approval_status}`}>
                        {row.approval_status.charAt(0).toUpperCase() + row.approval_status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={load} />
        </section>
      )}
    </div>
  );
}
