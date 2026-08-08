import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient, extractErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { InvoiceDetail } from '../types';

const APPROVAL_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function InvoiceDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<number | null>(null);
const loadInvoice = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<InvoiceDetail>(`/invoices/${id}`);
      setInvoice(data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load invoice.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleApprove = async (approvalId: number) => {
    const remarks = prompt('Remarks (optional):') || undefined;
    setActingOnId(approvalId);
    setActionError(null);
    try {
      await apiClient.post(`/invoices/${id}/approvals/${approvalId}/approve`, { remarks });
      await loadInvoice();
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Failed to approve.'));
    } finally {
      setActingOnId(null);
    }
  };

  const handleReject = async (approvalId: number) => {
    const remarks = prompt('Reason for rejection:') || undefined;
    setActingOnId(approvalId);
    setActionError(null);
    try {
      await apiClient.post(`/invoices/${id}/approvals/${approvalId}/reject`, { remarks });
      await loadInvoice();
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Failed to reject.'));
    } finally {
      setActingOnId(null);
    }
  };

  const handleResetApprovals = async () => {
    if (!confirm('Reset this invoice back to pending at every approval level?')) return;
    setActionError(null);
    try {
      await apiClient.post(`/invoices/${id}/approvals/reset`);
      await loadInvoice();
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Failed to reset approvals.'));
    }
  };

  if (loading) return <div className="page">Loading...</div>;
  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;
  if (!invoice) return null;

  return (
    <div className="page invoice-detail">
      <div className="page-header no-print">
        <h1>
          Invoice {invoice.invoice_no}{' '}
          <span className={`approval-badge approval-badge-${invoice.approval_status}`}>
            {APPROVAL_STATUS_LABEL[invoice.approval_status]}
          </span>
        </h1>
        <div className="table-actions">
          <Link to={`/invoices/${invoice.id}/edit`}>
            <button type="button">Edit</button>
          </Link>
          {invoice.approval_status === 'approved' && (
            <Link to={`/invoices/${invoice.id}/print`}>
              <button type="button">Print Bill</button>
            </Link>
          )}
        </div>
      </div>

      <div className="invoice-print-area">
        <div className="invoice-print-header">
          <h2>Cathlab Billing Invoice</h2>
          <p>Invoice No: {invoice.invoice_no}</p>
          <p>Date: {invoice.invoice_date}</p>
          <p>Status: {invoice.status}</p>
        </div>

        <section className="card">
          <h3>Patient Details</h3>
          <div className="detail-grid">
            <span>UHID</span>
            <span>{invoice.patient_uhid}</span>
            <span>Name</span>
            <span>{invoice.patient_name}</span>
            <span>Age</span>
            <span>{invoice.patient_age}</span>
            <span>Gender</span>
            <span>{invoice.patient_gender}</span>
            <span>Mobile</span>
            <span>{invoice.patient_mobile}</span>
            <span>Doctor</span>
            <span>{invoice.doctor_name}</span>
          </div>
        </section>

        <section className="card">
          <h3>Line Items</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th>Qty</th>
                <th>MRP</th>
                <th>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((line) => (
                <tr key={line.id}>
                  <td>{line.item_name}</td>
                  <td>{line.batch_no}</td>
                  <td>{line.expiry_date}</td>
                  <td>{line.quantity}</td>
                  <td>{Number(line.mrp).toFixed(2)}</td>
                  <td>{Number(line.line_total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card totals-card">
          <h3>Totals</h3>
          <div className="totals-grid">
            <span>Subtotal</span>
            <span>₹{Number(invoice.subtotal).toFixed(2)}</span>
            <span>Discount ({invoice.discount_percent}%)</span>
            <span>-₹{Number(invoice.discount_amount).toFixed(2)}</span>
            <span className="totals-final-label">Total</span>
            <span className="totals-final-value">₹{Number(invoice.total_amount).toFixed(2)}</span>
          </div>
        </section>
      </div>

      <section className="card no-print">
        <div className="page-header">
          <h3>Approvals</h3>
          {invoice.approval_status === 'rejected' && can('approval_levels', 'edit') && (
            <button type="button" className="btn-secondary" onClick={handleResetApprovals}>
              Reset to Pending
            </button>
          )}
        </div>

        {actionError && <div className="alert alert-error">{actionError}</div>}

        <table className="data-table">
          <thead>
            <tr>
              <th>Level</th>
              <th>Status</th>
              <th>Acted By</th>
              <th>Acted At</th>
              <th>Remarks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoice.approvals.map((approval) => (
              <tr key={approval.id}>
                <td>{approval.level_name}</td>
                <td>{APPROVAL_STATUS_LABEL[approval.status]}</td>
                <td>{approval.acted_by_name || '-'}</td>
                <td>{approval.acted_at || '-'}</td>
                <td>{approval.remarks || '-'}</td>
                <td className="table-actions">
                  {approval.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => handleApprove(approval.id)}
                      disabled={actingOnId === approval.id}
                    >
                      Approve
                    </button>
                  )}
                  {(approval.status === 'pending' || approval.status === 'approved') && can('approval_levels', 'edit') && (
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => handleReject(approval.id)}
                      disabled={actingOnId === approval.id}
                    >
                      Reject
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {invoice.approvals.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  No approval levels configured — this invoice was auto-approved.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
