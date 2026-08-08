import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, extractErrorMessage } from '../api/client';
import { Pagination } from '../components/Pagination';
import type { InvoiceListItem, PaginatedResponse } from '../types';

export function InvoiceListPage() {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async (targetPage = 1, searchVal = search, fromVal = from, toVal = to) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<PaginatedResponse<InvoiceListItem>>('/invoices', {
        params: {
          page: targetPage,
          pageSize: 20,
          search: searchVal || undefined,
          from: fromVal || undefined,
          to: toVal || undefined,
        },
      });
      setInvoices(data.data);
      setPage(data.page);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages || 1);
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

  // Live search: fire 350ms after the user stops typing
  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(1, val, from, to), 350);
  };

  const handleDateChange = (field: 'from' | 'to', val: string) => {
    const newFrom = field === 'from' ? val : from;
    const newTo = field === 'to' ? val : to;
    if (field === 'from') setFrom(val); else setTo(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(1, search, newFrom, newTo), 350);
  };

  return (
    <div className="page">
      <h1>Invoices</h1>

      <div className="filter-bar">
        <input
          className="invoice-search-input"
          placeholder="Search by invoice no., patient name or UHID…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          autoComplete="off"
        />
        <input type="date" value={from} onChange={(e) => handleDateChange('from', e.target.value)} />
        <input type="date" value={to} onChange={(e) => handleDateChange('to', e.target.value)} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          {total > 0 && (
            <p className="report-count">{total} invoice{total !== 1 ? 's' : ''} found</p>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice No.</th>
                <th>Date</th>
                <th>Patient</th>
                <th>UHID</th>
                <th>Total</th>
                <th>Status</th>
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link to={`/invoices/${inv.id}`}>{inv.invoice_no}</Link>
                  </td>
                  <td>{inv.invoice_date}</td>
                  <td>{inv.patient_name}</td>
                  <td>{inv.patient_uhid}</td>
                  <td>₹{Number(inv.total_amount).toFixed(2)}</td>
                  <td>{inv.status}</td>
                  <td>
                    <span className={`approval-badge approval-badge-${inv.approval_status}`}>
                      {inv.approval_status}
                    </span>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-row">
                    No invoices found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={load} />
        </>
      )}
    </div>
  );
}
