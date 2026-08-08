import { useEffect, useState } from 'react';
import { apiClient, extractErrorMessage } from '../api/client';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../context/AuthContext';
import type { Item, MasterOption, PaginatedResponse } from '../types';

const PAGE_SIZE = 50;

type ImportResult = {
  inserted: number;
  skipped: number;
  errors: { row: number; item?: string; reason: string }[];
};

const emptyForm = {
  id: 0,
  item_code: '',
  item_name: '',
  short_name: '',
  category_id: '' as number | '',
  purchase_cost: '' as number | '',
  mrp: 0,
  unit_id: '' as number | '',
  is_active: true,
};

export function ItemsPage() {
  const { can } = useAuth();
  const canCreate = can('items', 'create');
  const canEdit = can('items', 'edit');
  const canDelete = can('items', 'delete');
  const canManage = canEdit || canDelete;

  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<MasterOption[]>([]);
  const [units, setUnits] = useState<MasterOption[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const loadItems = async (targetPage = 1) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<PaginatedResponse<Item>>('/items', {
        params: { page: targetPage, pageSize: PAGE_SIZE, search: search || undefined },
      });
      setItems(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load items.'));
    } finally {
      setLoading(false);
    }
  };

  const loadOptions = async () => {
    try {
      const [categoryRes, unitRes] = await Promise.all([
        apiClient.get<MasterOption[]>('/categories', { params: { activeOnly: 'true' } }),
        apiClient.get<MasterOption[]>('/units', { params: { activeOnly: 'true' } }),
      ]);
      setCategories(categoryRes.data);
      setUnits(unitRes.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load category/unit options.'));
    }
  };

  useEffect(() => {
    loadOptions();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => loadItems(1), 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openCreateForm = () => {
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (item: Item) => {
    setForm({
      id: item.id,
      item_code: item.item_code,
      item_name: item.item_name,
      short_name: item.short_name ?? '',
      category_id: item.category_id ?? '',
      purchase_cost: item.purchase_cost === null ? '' : item.purchase_cost,
      mrp: item.mrp,
      unit_id: item.unit_id ?? '',
      is_active: !!item.is_active,
    });
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        item_name: form.item_name,
        short_name: form.short_name.trim() || null,
        category_id: form.category_id === '' ? null : Number(form.category_id),
        purchase_cost: form.purchase_cost === '' ? null : Number(form.purchase_cost),
        mrp: Number(form.mrp),
        unit_id: form.unit_id === '' ? null : Number(form.unit_id),
        is_active: form.is_active,
      };

      if (form.id) {
        await apiClient.put(`/items/${form.id}`, payload);
      } else {
        await apiClient.post('/items', payload);
      }

      setShowForm(false);
      await loadItems(form.id ? page : 1);
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Failed to save item.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: Item) => {
    if (!confirm(`Delete item "${item.item_name}"?`)) return;
    try {
      await apiClient.delete(`/items/${item.id}`);
      await loadItems(items.length === 1 && page > 1 ? page - 1 : page);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to delete item.'));
    }
  };

  const openImport = () => {
    setImportFile(null);
    setImportResult(null);
    setImportError(null);
    setShowImport(true);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      const { data } = await apiClient.post<ImportResult>('/items/bulk-import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(data);
      if (data.inserted > 0) await loadItems(1);
    } catch (err) {
      setImportError(extractErrorMessage(err, 'Import failed.'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Item Master</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {canCreate && <button onClick={openImport} className="btn-secondary">Import Excel</button>}
          {canCreate && <button onClick={openCreateForm}>+ Add Item</button>}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <input
        className="search-input"
        placeholder="Search by code or name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {showImport && (
        <div className="modal-backdrop" onClick={() => !importing && setShowImport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: '480px' }}>
            <h2>Import Items from Excel</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #666)', margin: '0 0 1rem' }}>
              Expected columns: <strong>Item</strong>, <strong>Category</strong>, <strong>Group</strong>, <strong>P.Rate</strong>, <strong>Org.Mrp</strong>
              <br />Existing items (same name) are skipped. New categories/units are created automatically.
            </p>

            {importError && <div className="alert alert-error">{importError}</div>}

            {!importResult ? (
              <>
                <label>
                  Excel File (.xlsx / .xls)
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {importing && (
                  <div style={{ margin: '1rem 0', textAlign: 'center', color: 'var(--text-muted, #666)', fontSize: '0.9rem' }}>
                    <div style={{ marginBottom: '0.5rem' }}>Importing, please wait...</div>
                    <div style={{ height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--color-primary, #0066cc)', borderRadius: '3px', width: '100%', animation: 'pulse 1.5s ease-in-out infinite', opacity: 0.7 }} />
                    </div>
                    <div style={{ marginTop: '0.4rem', fontSize: '0.8rem' }}>Large files may take up to 30 seconds.</div>
                  </div>
                )}
                <div className="modal-actions">
                  <button onClick={() => setShowImport(false)} className="btn-secondary" disabled={importing}>
                    Cancel
                  </button>
                  <button onClick={handleImport} disabled={!importFile || importing}>
                    {importing ? 'Importing...' : 'Import'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ margin: '0.75rem 0', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'green', fontWeight: 600 }}>{importResult.inserted.toLocaleString()} inserted</span>
                  <span style={{ color: '#888' }}>{importResult.skipped.toLocaleString()} skipped (duplicates)</span>
                  {importResult.errors.length > 0 && (
                    <span style={{ color: 'var(--color-danger, #c00)' }}>{importResult.errors.length.toLocaleString()} errors</span>
                  )}
                </div>
                {importResult.errors.length > 0 && (
                  <div style={{ maxHeight: '200px', overflowY: 'auto', fontSize: '0.82rem', border: '1px solid #ddd', borderRadius: '4px', padding: '0.5rem' }}>
                    {importResult.errors.map((e, i) => (
                      <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid #f0f0f0' }}>
                        Row {e.row}{e.item ? ` — ${e.item}` : ''}: {e.reason}
                      </div>
                    ))}
                  </div>
                )}
                <div className="modal-actions">
                  <button onClick={() => setShowImport(false)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{form.id ? 'Edit Item' : 'Add Item'}</h2>

            {formError && <div className="alert alert-error">{formError}</div>}

            <div className="form-grid">
              {form.id ? (
                <label>
                  Item Code
                  <input value={form.item_code} readOnly disabled />
                </label>
              ) : null}
              <label>
                Item Name
                <input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} />
              </label>
              <label>
                Short Name
                <input value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} />
              </label>
              <label>
                Category
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value === '' ? '' : Number(e.target.value) })}
                >
                  <option value="">Select category</option>
                  {categories.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Purchase Cost
                <input
                  type="number"
                  value={form.purchase_cost}
                  onChange={(e) => setForm({ ...form, purchase_cost: e.target.value === '' ? '' : Number(e.target.value) })}
                />
              </label>
              <label>
                MRP
                <input
                  type="number"
                  value={form.mrp}
                  onChange={(e) => setForm({ ...form, mrp: Number(e.target.value) })}
                />
              </label>
              <label>
                Unit
                <select
                  value={form.unit_id}
                  onChange={(e) => setForm({ ...form, unit_id: e.target.value === '' ? '' : Number(e.target.value) })}
                >
                  <option value="">Select unit</option>
                  {units.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Active
              </label>
            </div>
            <div className="modal-actions">
              <button onClick={closeForm} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.item_name.trim() || !form.category_id || !form.unit_id}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Short Name</th>
                <th>Category</th>
                <th>Purchase Cost</th>
                <th>MRP</th>
                <th>Unit</th>
                <th>Active</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.item_code}</td>
                  <td>{item.item_name}</td>
                  <td>{item.short_name || '-'}</td>
                  <td>{item.category_name || '-'}</td>
                  <td>{item.purchase_cost === null ? '-' : Number(item.purchase_cost).toFixed(2)}</td>
                  <td>{Number(item.mrp).toFixed(2)}</td>
                  <td>{item.unit_name || '-'}</td>
                  <td>{item.is_active ? 'Yes' : 'No'}</td>
                  {canManage && (
                    <td className="table-actions">
                      {canEdit && <button onClick={() => openEditForm(item)}>Edit</button>}
                      {canDelete && (
                        <button onClick={() => handleDelete(item)} className="btn-danger">
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 9 : 8} className="empty-row">
                    No items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={loadItems} />
        </>
      )}
    </div>
  );
}
