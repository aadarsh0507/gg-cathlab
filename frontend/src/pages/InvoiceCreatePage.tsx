import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, extractErrorMessage } from '../api/client';
import { PAYMENT_MODE_OPTIONS } from '../constants/invoiceOptions';
import type { Item, Patient, PaymentMode } from '../types';

interface LineItem {
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

export function InvoiceCreatePage() {
  const navigate = useNavigate();

  const [uhid, setUhid] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [fetchingPatient, setFetchingPatient] = useState(false);
  const [patientError, setPatientError] = useState<string | null>(null);

  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [patientGender, setPatientGender] = useState('');
  const [patientMobile, setPatientMobile] = useState('');
  const [patientAddress, setPatientAddress] = useState('');

  const [doctorName, setDoctorName] = useState('');
  const [department, setDepartment] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Credit');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [discountPercent, setDiscountPercent] = useState(0);
  const [itemQuery, setItemQuery] = useState('');
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [lines, setLines] = useState<LineItem[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  const fetchPatient = async () => {
    if (!uhid.trim()) return;
    setFetchingPatient(true);
    setPatientError(null);
    setPatient(null);
    try {
      const { data } = await apiClient.get<Patient>(`/patients/${encodeURIComponent(uhid.trim())}`);
      setPatient(data);
      setPatientName(data.name || '');
      setPatientAge(data.age !== null ? String(data.age) : '');
      setPatientGender(data.gender || '');
      setPatientMobile(data.mobile || '');
      setPatientAddress(data.address || '');
      if (data.doctor) setDoctorName(data.doctor);
      if (data.department) setDepartment(data.department);
    } catch (err) {
      setPatientError(extractErrorMessage(err, 'Failed to fetch patient.'));
    } finally {
      setFetchingPatient(false);
    }
  };

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

  const updateLine = (key: number, patch: Partial<LineItem>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: number) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const l of lines) {
      subtotal += l.quantity * l.mrp;
    }
    subtotal = round2(subtotal);
    const discountAmount = round2((subtotal * (Number(discountPercent) || 0)) / 100);
    const total = round2(subtotal - discountAmount);

    return { subtotal, discountAmount, total };
  }, [lines, discountPercent]);

  const canSubmit = patientName.trim() && lines.length > 0 && !submitting;

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        patient_uhid: uhid.trim(),
        patient_name: patientName,
        patient_age: patientAge,
        patient_gender: patientGender,
        patient_mobile: patientMobile,
        patient_address: patientAddress,
        doctor_name: doctorName,
        department: department,
        payment_mode: paymentMode,
        invoice_date: invoiceDate,
        bill_date: billDate || undefined,
        discount_percent: Number(discountPercent) || 0,
        items: lines.map((l) => ({
          item_id: l.item_id,
          item_name: l.item_name,
          batch_no: l.batch_no,
          expiry_date: l.expiry_date || null,
          quantity: l.quantity,
          mrp: l.mrp,
        })),
      };

      const { data } = await apiClient.post('/invoices', payload);

      navigate(`/invoices/${data.id}`);
    } catch (err) {
      setSubmitError(extractErrorMessage(err, 'Failed to create invoice.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <h1>New Invoice</h1>

      <section className="card">
        <h2>Patient</h2>
        <div className="inline-form">
          <label>
            UHID
            <input value={uhid} onChange={(e) => setUhid(e.target.value)} placeholder="Scan or enter UHID" />
          </label>
          <button onClick={fetchPatient} disabled={fetchingPatient || !uhid.trim()} type="button">
            {fetchingPatient ? 'Fetching...' : 'Fetch Patient'}
          </button>
        </div>

        {patientError && <div className="alert alert-error">{patientError}</div>}

        {patient && (
          <div className="detail-grid">
            <span>Doctor</span>
            <span>{patient.doctor || '-'}</span>
            <span>Department</span>
            <span>{patient.department || '-'}</span>
            <span>Bed</span>
            <span>{patient.bed || '-'}</span>
            <span>Nursing Station</span>
            <span>{patient.nurseStation || '-'}</span>
            <span>Admission Date</span>
            <span>{patient.admissionDate || '-'}</span>
            <span>Discharge Requested</span>
            <span>{patient.dischargeRequestDate || '-'}</span>
          </div>
        )}

        {(patient || manualEntry) && (
          <div className="form-grid">
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
        )}

        {!patient && !manualEntry && (
          <p className="hint">
            Enter a UHID and click Fetch, or{' '}
            <button type="button" className="link-button" onClick={() => setManualEntry(true)}>
              enter patient details manually
            </button>
            .
          </p>
        )}
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
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
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
          <label>
            Discount %
            <input type="number" value={discountPercent} onChange={(e) => setDiscountPercent(Number(e.target.value))} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Line Items</h2>
        <div className="item-picker">
          <input
            placeholder="Search items by code, name or short name..."
            value={itemQuery}
            onChange={(e) => setItemQuery(e.target.value)}
          />
          {itemResults.length > 0 && (
            <ul className="item-picker-results">
              {itemResults.map((item) => (
                <li key={item.id} onClick={() => addItemLine(item)}>
                  <strong>{item.item_code}</strong> — {item.item_name}
                  {item.short_name && <span style={{ color: '#888', marginLeft: '0.4em' }}>({item.short_name})</span>}
                  {' '}(MRP ₹{Number(item.mrp).toFixed(2)})
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
      </section>

      <section className="card totals-card">
        <h2>Summary</h2>
        <div className="totals-grid">
          <span>Subtotal</span>
          <span>₹{totals.subtotal.toFixed(2)}</span>
          <span>Discount</span>
          <span>-₹{totals.discountAmount.toFixed(2)}</span>
          <span className="totals-final-label">Total</span>
          <span className="totals-final-value">₹{totals.total.toFixed(2)}</span>
        </div>
      </section>

      {submitError && <div className="alert alert-error">{submitError}</div>}

      <div className="form-actions card no-print">
        <button onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? 'Creating Invoice...' : 'Create Invoice'}
        </button>
      </div>
    </div>
  );
}
