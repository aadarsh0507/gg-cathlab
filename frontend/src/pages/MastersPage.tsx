import { useEffect, useState } from 'react';
import { apiClient, extractErrorMessage } from '../api/client';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../context/AuthContext';
import { usePaginatedList } from '../hooks/usePaginatedList';
import type { MasterOption, Screen } from '../types';

type ImportResult = {
  inserted: number;
  skipped: number;
  errors: { row: number; reason: string }[];
};

interface MasterSectionProps {
  title: string;
  endpoint: string;
  itemLabel: string;
  screen: Screen;
  allowImport?: boolean;
}

const emptyForm = { id: 0, name: '', is_active: true };

function MasterSection({ title, endpoint, itemLabel, screen, allowImport }: MasterSectionProps) {
  const { can } = useAuth();
  const canCreate = can(screen, 'create');
  const canEdit = can(screen, 'edit');
  const canDelete = can(screen, 'delete');

  const [rows, setRows] = useState<MasterOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { pageItems, page, totalPages, setPage } = usePaginatedList(rows, 20);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<MasterOption[]>(endpoint);
      setRows(data);
    } catch (err) {
      setError(extractErrorMessage(err, `Failed to load ${itemLabel}s.`));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  const openCreateForm = () => {
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (row: MasterOption) => {
    setForm({ id: row.id, name: row.name, is_active: !!row.is_active });
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
      const payload = { name: form.name, is_active: form.is_active };
      if (form.id) {
        await apiClient.put(`${endpoint}/${form.id}`, payload);
      } else {
        await apiClient.post(endpoint, payload);
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(extractErrorMessage(err, `Failed to save ${itemLabel}.`));
    } finally {
      setSaving(false);
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
      const { data } = await apiClient.post<ImportResult>(`${endpoint}/bulk-import`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(data);
      if (data.inserted > 0) await load();
    } catch (err) {
      setImportError(extractErrorMessage(err, 'Import failed.'));
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (row: MasterOption) => {
    if (!confirm(`Delete ${itemLabel} "${row.name}"?`)) return;
    setError(null);
    try {
      await apiClient.delete(`${endpoint}/${row.id}`);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, `Failed to delete ${itemLabel}.`));
    }
  };

  return (
    <section className="card">
      <div className="page-header">
        <h2>{title}</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {canCreate && allowImport && <button className="btn-secondary" onClick={openImport}>Import Excel</button>}
          {canCreate && <button onClick={openCreateForm}>+ Add {itemLabel}</button>}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showImport && (
        <div className="modal-backdrop" onClick={() => !importing && setShowImport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: '440px' }}>
            <h2>Import {title} from Excel</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #666)', margin: '0 0 1rem' }}>
              The file must have a column named <strong>Name</strong> (or any column containing "name").
              <br />Existing entries with the same name are skipped automatically.
            </p>

            {importError && <div className="alert alert-error">{importError}</div>}

            {!importResult ? (
              <>
                <label>
                  Excel File (.xlsx / .xls)
                  <input type="file" accept=".xlsx,.xls" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
                </label>
                {importing && (
                  <div style={{ margin: '1rem 0', textAlign: 'center', color: 'var(--text-muted,#666)', fontSize: '0.9rem' }}>
                    <div style={{ marginBottom: '0.4rem' }}>Importing, please wait...</div>
                    <div style={{ height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--color-primary,#0066cc)', borderRadius: '3px', width: '100%', opacity: 0.7 }} />
                    </div>
                  </div>
                )}
                <div className="modal-actions">
                  <button className="btn-secondary" onClick={() => setShowImport(false)} disabled={importing}>Cancel</button>
                  <button onClick={handleImport} disabled={!importFile || importing}>
                    {importing ? 'Importing...' : 'Import'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ margin: '0.75rem 0', display: 'flex', gap: '1.5rem' }}>
                  <span style={{ color: 'green', fontWeight: 600 }}>{importResult.inserted.toLocaleString()} inserted</span>
                  <span style={{ color: '#888' }}>{importResult.skipped.toLocaleString()} skipped (duplicates)</span>
                  {importResult.errors.length > 0 && (
                    <span style={{ color: 'var(--color-danger,#c00)' }}>{importResult.errors.length} errors</span>
                  )}
                </div>
                {importResult.errors.length > 0 && (
                  <div style={{ maxHeight: '180px', overflowY: 'auto', fontSize: '0.82rem', border: '1px solid #ddd', borderRadius: '4px', padding: '0.5rem' }}>
                    {importResult.errors.map((e, i) => (
                      <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid #f0f0f0' }}>
                        Row {e.row}: {e.reason}
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
            <h2>{form.id ? `Edit ${itemLabel}` : `Add ${itemLabel}`}</h2>

            {formError && <div className="alert alert-error">{formError}</div>}

            <div className="form-grid">
              <label>
                Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
              <button onClick={handleSave} disabled={saving || !form.name.trim()}>
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
                <th>Name</th>
                <th>Active</th>
                {(canEdit || canDelete) && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.is_active ? 'Yes' : 'No'}</td>
                  {(canEdit || canDelete) && (
                    <td className="table-actions">
                      {canEdit && <button onClick={() => openEditForm(row)}>Edit</button>}
                      {canDelete && (
                        <button onClick={() => handleDelete(row)} className="btn-danger">
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={canEdit || canDelete ? 3 : 2} className="empty-row">
                    No {itemLabel}s found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </section>
  );
}

export function MastersPage() {
  const { canView } = useAuth();

  return (
    <div className="page">
      <h1>Masters</h1>
      {canView('categories') && (
        <MasterSection title="Categories" endpoint="/categories" itemLabel="category" screen="categories" />
      )}
      {canView('units') && <MasterSection title="Units" endpoint="/units" itemLabel="unit" screen="units" />}
      {canView('vendors') && (
        <MasterSection title="Vendors" endpoint="/vendors" itemLabel="vendor" screen="vendors" allowImport />
      )}
    </div>
  );
}
