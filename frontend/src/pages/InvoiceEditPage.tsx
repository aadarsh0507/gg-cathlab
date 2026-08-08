import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient, extractErrorMessage } from '../api/client';
import { PAYMENT_MODE_OPTIONS } from '../constants/invoiceOptions';
import type { InvoiceDetail, InvoiceLineDetail, Item, PaymentMode } from '../types';

interface EditLineItem {
  key: number;
  item_id: number | null;
  item_name: string;
  mrp: number;
  quantity: number;
  batch_no: string;
  expiry_date: string;
}

let lineKeySeq = 1;

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toEditLines(items: InvoiceLineDetail[]): EditLineItem[] {
  return items.map((l) => ({
    key: lineKeySeq++,
    item_id: l.item_id,
    item_name: l.item_name,
    mrp: Number(l.mrp),
    quantity: l.quantity,
    batch_no: l.batch_no || '',
    expiry_date: l.expiry_date || '',
  }));
}

export function InvoiceEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [patientUhid, setPatientUhid] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [patientGender, setPatientGender] = useState('');
  const [patientMobile, setPatientMobile] = useState('');
  const [patientAddress, setPatientAddress] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [department, setDepartment] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Credit');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [billDate, setBillDate] = useState('');
  const [discountPercent, setDiscountPercent] = useState(0);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [lines, setLines] = useState<EditLineItem[]>([]);
  const [itemQuery, setItemQuery] = useState('');
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [savingItems, setSavingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  useEffect(() => {
    if (!itemQuery.trim()) {
      setItemResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const { data } = await apiClient.get<Item[]>('/items', {
          params: { search: itemQuery, activeOnly: 'true', paginate: 'false' },
        });
        setItemResults(data);
      } catch {
        setItemResults([]);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [itemQuery]);

  const addItemLine = (item: Item) => {
    setLines((prev) => [
      ...prev,
      {
        key: lineKeySeq++,
        item_id: item.id,
        item_name: item.item_name,
        mrp: Number(item.mrp),
        quantity: 1,
        batch_no: '',
        expiry_date: '',
      },
    ]);
    setItemQuery('');
    setItemResults([]);
  };

  const updateLine = (key: number, patch: Partial<EditLineItem>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: number) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const itemTotals = useMemo(() => {
    let subtotal = 0;
    for (const l of lines) {
      subtotal += l.quantity * l.mrp;
    }
    subtotal = round2(subtotal);
    const discountAmount = round2((subtotal * (Number(discountPercent) || 0)) / 100);
    const total = round2(subtotal - discountAmount);
    return { subtotal, discountAmount, total };
  }, [lines, discountPercent]);

  const loadInvoice = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await apiClient.get<InvoiceDetail>(`/invoices/${id}`);
      setInvoice(data);
      setPatientUhid(data.patient_uhid);
      setPatientName(data.patient_name);
      setPatientAge(data.patient_age || '');
      setPatientGender(data.patient_gender || '');
      setPatientMobile(data.patient_mobile || '');
      setPatientAddress(data.patient_address || '');
      setDoctorName(data.doctor_name || '');
      setDepartment(data.department || '');
      setPaymentMode(data.payment_mode);
      setInvoiceDate(data.invoice_date ? data.invoice_date.slice(0, 10) : '');
      setBillDate(data.bill_date ? data.bill_date.slice(0, 10) : new Date().toISOString().slice(0, 10));
      setDiscountPercent(Number(data.discount_percent) || 0);
      setLines(toEditLines(data.items));
    } catch (err) {
      setLoadError(extractErrorMessage(err, 'Failed to load invoice.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.put(`/invoices/${id}`, {
        patient_uhid: patientUhid,
        patient_name: patientName,
        patient_age: patientAge,
        patient_gender: patientGender,
        patient_mobile: patientMobile,
        patient_address: patientAddress,
        doctor_name: doctorName,
        department,
        payment_mode: paymentMode,
        invoice_date: invoiceDate,
        bill_date: billDate || undefined,
      });
      navigate(`/invoices/${id}`);
    } catch (err) {
      setSaveError(extractErrorMessage(err, 'Failed to save invoice.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveItems = async () => {
    setSavingItems(true);
    setItemsError(null);
    try {
      await apiClient.put(`/invoices/${id}/items`, {
        discount_percent: Number(discountPercent) || 0,
        items: lines.map((l) => ({
          item_id: l.item_id,
          item_name: l.item_name,
          batch_no: l.batch_no,
          expiry_date: l.expiry_date || null,
          quantity: l.quantity,
          mrp: l.mrp,
        })),
      });
      await loadInvoice();
    } catch (err) {
      setItemsError(extractErrorMessage(err, 'Failed to save items.'));
    } finally {
      setSavingItems(false);
    }
  };

  if (loading) return <div className="page">Loading...</div>;
  if (loadError) return <div className="page"><div className="alert alert-error">{loadError}</div></div>;
  if (!invoice) return null;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Edit Invoice {invoice.invoice_no}</h1>
        <Link to={`/invoices/${invoice.id}`}>
          <button type="button" className="btn-secondary">
            Cancel
          </button>
        </Link>
      </div>

      <p className="hint">
        Editing line items recalculates the invoice total. If this invoice was already approved, changing items
        resets its approval status back to pending.
      </p>

      <section className="card">
        <h2>Patient</h2>
        <div className="form-grid">
          <label>
            UHID
            <input value={patientUhid} onChange={(e) => setPatientUhid(e.target.value)} />
          </label>
          <label>
            Name
            <input value={patientName} onChange={(e) => setPatientName(e.target.value)} />
          </label>
          <label>
            Age
            <input value={patientAge} onChange={(e) => setPatientAge(e.target.value)} />
          </label>
          <label>
            Gender
            <input value={patientGender} onChange={(e) => setPatientGender(e.target.value)} />
          </label>
          <label>
            Mobile
            <input value={patientMobile} onChange={(e) => setPatientMobile(e.target.value)} />
          </label>
          <label>
            Address
            <input value={patientAddress} onChange={(e) => setPatientAddress(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Invoice Details</h2>
        <div className="form-grid">
          <label>
            Doctor Name
            <input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} />
          </label>
          <label>
            Department
            <input value={department} onChange={(e) => setDepartment(e.target.value)} />
          </label>
          <label>
            Invoice Date
            <input type="date" value={invoiceDate} readOnly className="input-readonly" />
          </label>
          <label>
            Bill Date
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </label>
          <label>
            Payment Mode
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}>
              {PAYMENT_MODE_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {saveError && <div className="alert alert-error">{saveError}</div>}

      <div className="form-actions card no-print">
        <button onClick={handleSave} disabled={saving || !patientUhid.trim() || !patientName.trim()}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <section className="card">
        <h2>Line Items</h2>
        <div className="item-picker">
          <input
            placeholder="Search items by code or name to add..."
            value={itemQuery}
            onChange={(e) => setItemQuery(e.target.value)}
          />
          {itemResults.length > 0 && (
            <ul className="item-picker-results">
              {itemResults.map((item) => (
                <li key={item.id} onClick={() => addItemLine(item)}>
                  <strong>{item.item_code}</strong> — {item.item_name} (MRP ₹{Number(item.mrp).toFixed(2)})
                </li>
              ))}
            </ul>
          )}
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Batch No.</th>
              <th>Expiry</th>
              <th>Qty</th>
              <th>MRP</th>
              <th>Line Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const lineTotalApprox = round2(l.quantity * l.mrp);
              return (
                <tr key={l.key}>
                  <td>{l.item_name}</td>
                  <td>
                    <input value={l.batch_no} onChange={(e) => updateLine(l.key, { batch_no: e.target.value })} />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={l.expiry_date}
                      onChange={(e) => updateLine(l.key, { expiry_date: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      className="qty-input"
                      value={l.quantity}
                      onChange={(e) => updateLine(l.key, { quantity: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="price-input"
                      value={l.mrp}
                      onChange={(e) => updateLine(l.key, { mrp: Number(e.target.value) })}
                    />
                  </td>
                  <td>{lineTotalApprox.toFixed(2)}</td>
                  <td>
                    <button type="button" className="btn-danger" onClick={() => removeLine(l.key)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">
                  No items added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="form-grid">
          <label>
            Discount %
            <input
              type="number"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="totals-grid">
          <span>Subtotal</span>
          <span>₹{itemTotals.subtotal.toFixed(2)}</span>
          <span>Discount</span>
          <span>-₹{itemTotals.discountAmount.toFixed(2)}</span>
          <span className="totals-final-label">Total</span>
          <span className="totals-final-value">₹{itemTotals.total.toFixed(2)}</span>
        </div>

        {itemsError && <div className="alert alert-error">{itemsError}</div>}

        <div className="form-actions no-print">
          <button onClick={handleSaveItems} disabled={savingItems || lines.length === 0}>
            {savingItems ? 'Saving Items...' : 'Save Items'}
          </button>
        </div>
      </section>
    </div>
  );
}
