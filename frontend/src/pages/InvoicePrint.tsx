import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient, extractErrorMessage } from '../api/client';
import { amountInWords } from '../utils/amountInWords';
import letterhead from '../assets/hospital-letterhead.png';
import type { InvoiceDetail, PaymentMode } from '../types';
import './InvoicePrint.css';

const BILL_TITLES: Record<PaymentMode, string> = {
  Credit: 'INVOICE',
  Cash: 'INVOICE',
  Card: 'INVOICE',
  UPI: 'INVOICE',
  Insurance: 'INVOICE',
  Cheque: 'INVOICE',
};


function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const s = dateStr.slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function fmtCreatedAt(isoStr: string | null | undefined): string {
  if (!isoStr) return '-';
  const dt = new Date(isoStr);
  if (isNaN(dt.getTime())) return isoStr;
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const y = dt.getFullYear();
  let hours = dt.getHours();
  const minutes = String(dt.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${d}/${m}/${y} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

export function InvoicePrint() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bill date: editable in toolbar, defaults to today
  const [billDate, setBillDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await apiClient.get<InvoiceDetail>(`/invoices/${id}`);
        setInvoice(data);
        // If a bill_date was previously saved, pre-fill it; otherwise today
        if (data.bill_date) {
          setBillDate(data.bill_date.slice(0, 10));
        }
      } catch (err) {
        setError(extractErrorMessage(err, 'Failed to load invoice.'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handlePrint = async () => {
    // Save bill_date to DB then print
    try {
      await apiClient.patch(`/invoices/${id}/bill-date`, { bill_date: billDate });
    } catch {
      // non-blocking — still print even if save fails
    }
    window.print();
  };

  if (loading) return <div className="print-page-status">Loading...</div>;
  if (error) return <div className="print-page-status print-page-error">{error}</div>;
  if (!invoice) return null;
  if (invoice.approval_status !== 'approved') {
    return <div className="print-page-status print-page-error">This invoice has not been approved. Printing is not allowed.</div>;
  }

  const billTitle = BILL_TITLES[invoice.payment_mode] || 'INVOICE';

  return (
    <div className="bill-page">
      {/* Toolbar — hidden on print */}
      <div className="bill-toolbar no-print">
        <button onClick={handlePrint}>Print</button>
      </div>

      <div className="bill-sheet">
        <img src={letterhead} alt="GG Hospital" className="bill-letterhead" />

        <div className="bill-title">{billTitle}</div>

        <table className="bill-info-table">
          <tbody>
            <tr>
              <td className="bill-label">Patient ID</td>
              <td className="bill-colon">:</td>
              <td className="bill-value">{invoice.patient_uhid}</td>
              <td className="bill-label-right">Bill #</td>
              <td className="bill-colon-right">:</td>
              <td className="bill-value-right">{invoice.invoice_no}</td>
            </tr>
            <tr>
              <td className="bill-label">Patient Name</td>
              <td className="bill-colon">:</td>
              <td className="bill-value">{invoice.patient_name}</td>
              <td className="bill-label-right">DO Date</td>
              <td className="bill-colon-right">:</td>
              <td className="bill-value-right">{fmtDate(billDate)}</td>
            </tr>
            <tr>
              <td className="bill-label">Age &amp; Gender</td>
              <td className="bill-colon">:</td>
              <td className="bill-value">
                {invoice.patient_age ? `${invoice.patient_age} Y` : '-'} / {invoice.patient_gender || '-'}
              </td>
              <td className="bill-label-right">Invoice Date</td>
              <td className="bill-colon-right">:</td>
              <td className="bill-value-right">{fmtCreatedAt(invoice.created_at)}</td>
            </tr>
            <tr>
              <td className="bill-label">Contact No.</td>
              <td className="bill-colon">:</td>
              <td className="bill-value">{invoice.patient_mobile || '-'}</td>
              <td className="bill-label-right">Doctor</td>
              <td className="bill-colon-right">:</td>
              <td className="bill-value-right">{invoice.doctor_name || '-'}</td>
            </tr>
            <tr>
              <td className="bill-label">Address</td>
              <td className="bill-colon">:</td>
              <td className="bill-value">{invoice.patient_address || '-'}</td>
              <td className="bill-label-right">Department</td>
              <td className="bill-colon-right">:</td>
              <td className="bill-value-right">{invoice.department || '-'}</td>
            </tr>
          </tbody>
        </table>

        <table className="bill-items-table">
          <thead>
            <tr>
              <th className="bill-col-sl">Sl#</th>
              <th className="bill-col-desc">Description</th>
              <th className="bill-col-qty">Qty</th>
              <th className="bill-col-amount">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((line, index) => (
              <tr key={line.id}>
                <td className="bill-col-sl">{index + 1}</td>
                <td className="bill-col-desc">{line.item_name}</td>
                <td className="bill-col-qty">{Number(line.quantity).toFixed(2)}</td>
                <td className="bill-col-amount">{Number(line.line_total).toFixed(2)}</td>
              </tr>
            ))}
            <tr className="bill-subtotal-row">
              <td colSpan={3}></td>
              <td className="bill-col-amount">{Number(invoice.subtotal).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <table className="bill-totals-table">
          <tbody>
            <tr>
              <td className="bill-totals-spacer"></td>
              <td className="bill-totals-label">Gross Amount</td>
              <td className="bill-totals-value">{Number(invoice.subtotal).toFixed(2)}</td>
            </tr>
            <tr className="bill-totals-final">
              <td className="bill-totals-spacer"></td>
              <td className="bill-totals-label">Patient Payable</td>
              <td className="bill-totals-value">{Number(invoice.total_amount).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div className="bill-amount-words">
          Patient Payable : {amountInWords(Number(invoice.total_amount))}
        </div>

        <div className="bill-footer">
          <div className="bill-footer-left">Payment Mode : Credit</div>
          <div className="bill-footer-right">
            <div className="bill-auth-sign">Authorised Signatory</div>
          </div>
        </div>

        <div className="bill-note">
          <span>N.B: Computer Generated Bill Signature Not Required</span>
          <span className="bill-page-no">Page 1 of 1</span>
        </div>
      </div>
    </div>
  );
}
