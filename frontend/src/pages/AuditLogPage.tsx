import { useEffect, useState } from 'react';
import { apiClient, extractErrorMessage } from '../api/client';
import { Pagination } from '../components/Pagination';
import { SCREEN_LABELS, SCREEN_LIST } from '../types';
import type { AuditLogEntry } from '../types';

const ACTION_LABELS: Record<AuditLogEntry['action'], string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
};

const PAGE_SIZE = 50;

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function formatFieldName(field: string): string {
  return field
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function changeSummary(entry: AuditLogEntry): string {
  if (!entry.details) return '-';
  const fields = Object.keys(entry.details);
  if (fields.length === 0) return '-';
  if (entry.action === 'delete') return `Removed: ${fields.map(formatFieldName).join(', ')}`;
  if (entry.action === 'create') return `Set: ${fields.map(formatFieldName).join(', ')}`;
  return fields.map((f) => formatFieldName(f)).join(', ');
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [screen, setScreen] = useState('');
  const [action, setAction] = useState('');
  const [username, setUsername] = useState('');

  const [detailEntry, setDetailEntry] = useState<AuditLogEntry | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<{ entries: AuditLogEntry[]; total: number }>('/audit-log', {
        params: {
          page,
          pageSize: PAGE_SIZE,
          ...(screen ? { screen } : {}),
          ...(action ? { action } : {}),
          ...(username ? { username } : {}),
        },
      });
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load audit log.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const applyFilters = () => {
    setPage(1);
    load();
  };

  const clearFilters = () => {
    setScreen('');
    setAction('');
    setUsername('');
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page">
      <div className="page-header">
        <h1>Audit Log</h1>
      </div>

      <p className="hint">A record of every create, update, and delete made across the system.</p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="inline-form">
        <label>
          Screen
          <select value={screen} onChange={(e) => setScreen(e.target.value)}>
            <option value="">All screens</option>
            {SCREEN_LIST.filter((s) => s !== 'audit_log').map((s) => (
              <option key={s} value={s}>
                {SCREEN_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
          </select>
        </label>
        <label>
          User
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
        </label>
        <button type="button" onClick={applyFilters}>
          Filter
        </button>
        <button type="button" className="btn-secondary" onClick={clearFilters}>
          Clear
        </button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date/Time</th>
                <th>User</th>
                <th>Screen</th>
                <th>Action</th>
                <th>Record ID</th>
                <th>Changes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.created_at}</td>
                  <td>{entry.username}</td>
                  <td>{SCREEN_LABELS[entry.screen] || entry.screen}</td>
                  <td>{ACTION_LABELS[entry.action]}</td>
                  <td>{entry.record_id || '-'}</td>
                  <td>
                    {entry.details && Object.keys(entry.details).length > 0 ? (
                      <button type="button" className="link-button" onClick={() => setDetailEntry(entry)}>
                        {changeSummary(entry)}
                      </button>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-row">
                    No audit log entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}

      {detailEntry && (
        <div className="modal-backdrop" onClick={() => setDetailEntry(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              {ACTION_LABELS[detailEntry.action]} — {SCREEN_LABELS[detailEntry.screen] || detailEntry.screen}
            </h2>
            <p className="hint">
              {detailEntry.username} · {detailEntry.created_at}
              {detailEntry.record_id ? ` · Record #${detailEntry.record_id}` : ''}
            </p>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>From</th>
                  <th>To</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(detailEntry.details || {}).map(([field, change]) => (
                  <tr key={field}>
                    <td>{formatFieldName(field)}</td>
                    <td>{detailEntry.action === 'create' ? '-' : formatValue(change.from)}</td>
                    <td>{detailEntry.action === 'delete' ? '-' : formatValue(change.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setDetailEntry(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
