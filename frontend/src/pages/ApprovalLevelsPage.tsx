import { useEffect, useState } from 'react';
import { apiClient, extractErrorMessage } from '../api/client';
import { Pagination } from '../components/Pagination';
import { usePaginatedList } from '../hooks/usePaginatedList';
import type { ApprovalLevel, User } from '../types';

const emptyForm = { id: 0, name: '', sequence_order: 1, is_active: true, user_ids: [] as number[] };

export function ApprovalLevelsPage() {
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { pageItems, page, totalPages, setPage } = usePaginatedList(levels, 20);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [assigningLevelId, setAssigningLevelId] = useState<number | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [levelsRes, usersRes] = await Promise.all([
        apiClient.get<ApprovalLevel[]>('/approval-levels'),
        apiClient.get<User[]>('/users'),
      ]);
      setLevels(levelsRes.data);
      setUsers(usersRes.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load approval levels.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreateForm = () => {
    const nextSeq = levels.length > 0 ? Math.max(...levels.map((l) => l.sequence_order)) + 1 : 1;
    setForm({ ...emptyForm, sequence_order: nextSeq });
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (level: ApprovalLevel) => {
    setForm({
      id: level.id,
      name: level.name,
      sequence_order: level.sequence_order,
      is_active: !!level.is_active,
      user_ids: level.approvers.map((a) => a.id),
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
      const payload = { name: form.name, sequence_order: form.sequence_order, is_active: form.is_active };
      let levelId = form.id;
      if (form.id) {
        await apiClient.put(`/approval-levels/${form.id}`, payload);
      } else {
        const { data } = await apiClient.post<ApprovalLevel>('/approval-levels', payload);
        levelId = data.id;
      }
      await apiClient.put(`/approval-levels/${levelId}/approvers`, { user_ids: form.user_ids });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Failed to save approval level.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (level: ApprovalLevel) => {
    if (!confirm(`Delete approval level "${level.name}"?`)) return;
    setError(null);
    try {
      await apiClient.delete(`/approval-levels/${level.id}`);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to delete approval level.'));
    }
  };

  const openAssignForm = (level: ApprovalLevel) => {
    setAssigningLevelId(level.id);
    setSelectedUserIds(level.approvers.map((a) => a.id));
    setAssignmentError(null);
  };

  const closeAssignForm = () => {
    setAssigningLevelId(null);
    setAssignmentError(null);
  };

  const toggleUser = (userId: number) => {
    setSelectedUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const handleSaveAssignment = async () => {
    if (assigningLevelId === null) return;
    setSavingAssignment(true);
    setAssignmentError(null);
    try {
      await apiClient.put(`/approval-levels/${assigningLevelId}/approvers`, { user_ids: selectedUserIds });
      setAssigningLevelId(null);
      await load();
    } catch (err) {
      setAssignmentError(extractErrorMessage(err, 'Failed to save approvers.'));
    } finally {
      setSavingAssignment(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Approval Levels</h1>
        <button onClick={openCreateForm}>+ Add Level</button>
      </div>

      <p className="hint">
        Every invoice must pass each active level in order before it's considered approved. Assign the users who can
        act at each level.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{form.id ? 'Edit Level' : 'Add Level'}</h2>

            {formError && <div className="alert alert-error">{formError}</div>}

            <div className="form-grid">
              <label>
                Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Sequence Order
                <input
                  type="number"
                  min={1}
                  value={form.sequence_order}
                  onChange={(e) => setForm({ ...form, sequence_order: Number(e.target.value) })}
                />
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

            <div style={{ marginTop: '1rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Approvers</div>
              {users.length === 0 ? (
                <p className="hint">No users available.</p>
              ) : (
                <div className="form-grid">
                  {users.map((u) => (
                    <label key={u.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={form.user_ids.includes(u.id)}
                        onChange={() =>
                          setForm((f) => ({
                            ...f,
                            user_ids: f.user_ids.includes(u.id)
                              ? f.user_ids.filter((id) => id !== u.id)
                              : [...f.user_ids, u.id],
                          }))
                        }
                      />
                      {u.full_name} ({u.username})
                    </label>
                  ))}
                </div>
              )}
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

      {assigningLevelId !== null && (
        <div className="modal-backdrop" onClick={closeAssignForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Assign Approvers</h2>

            {assignmentError && <div className="alert alert-error">{assignmentError}</div>}

            <div className="form-grid">
              {users.map((u) => (
                <label key={u.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedUserIds.includes(u.id)}
                    onChange={() => toggleUser(u.id)}
                  />
                  {u.full_name} ({u.username})
                </label>
              ))}
              {users.length === 0 && <p className="hint">No users available.</p>}
            </div>
            <div className="modal-actions">
              <button onClick={closeAssignForm} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleSaveAssignment} disabled={savingAssignment}>
                {savingAssignment ? 'Saving...' : 'Save'}
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
                <th>Order</th>
                <th>Name</th>
                <th>Approvers</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((level) => (
                <tr key={level.id}>
                  <td>{level.sequence_order}</td>
                  <td>{level.name}</td>
                  <td>
                    {level.approvers.length > 0
                      ? level.approvers.map((a) => a.full_name).join(', ')
                      : <span className="hint">None assigned</span>}
                  </td>
                  <td>{level.is_active ? 'Yes' : 'No'}</td>
                  <td className="table-actions">
                    <button onClick={() => openAssignForm(level)}>Approvers</button>
                    <button onClick={() => openEditForm(level)}>Edit</button>
                    <button onClick={() => handleDelete(level)} className="btn-danger">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {levels.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-row">
                    No approval levels configured. Invoices will be auto-approved until at least one level exists.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
