import { useEffect, useState } from 'react';
import { apiClient, extractErrorMessage } from '../api/client';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../context/AuthContext';
import { usePaginatedList } from '../hooks/usePaginatedList';
import type { Role, User } from '../types';

const emptyForm = {
  id: 0,
  username: '',
  password: '',
  full_name: '',
  role_id: '' as number | '',
  is_active: true,
};

export function UsersPage() {
  const { can } = useAuth();
  const canCreate = can('users', 'create');
  const canEdit = can('users', 'edit');
  const canDelete = can('users', 'delete');

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { pageItems, page, totalPages, setPage } = usePaginatedList(users, 20);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<User[]>('/users');
      setUsers(data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load users.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    apiClient
      .get<Role[]>('/roles')
      .then(({ data }) => setRoles(data))
      .catch(() => setRoles([]));
  }, []);

  const openCreateForm = () => {
    setForm({ ...emptyForm, role_id: roles[0]?.id ?? '' });
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (u: User) => {
    setForm({
      id: u.id,
      username: u.username,
      password: '',
      full_name: u.full_name,
      role_id: u.role_id,
      is_active: !!u.is_active,
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
      const payload: Record<string, unknown> = {
        username: form.username,
        full_name: form.full_name,
        role_id: form.role_id,
        is_active: form.is_active,
      };
      if (form.password) {
        payload.password = form.password;
      }

      if (form.id) {
        await apiClient.put(`/users/${form.id}`, payload);
      } else {
        await apiClient.post('/users', payload);
      }

      setShowForm(false);
      await loadUsers();
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Failed to save user.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u: User) => {
    if (!confirm(`Delete user "${u.username}"?`)) return;
    try {
      await apiClient.delete(`/users/${u.id}`);
      await loadUsers();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to delete user.'));
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Users</h1>
        {canCreate && <button onClick={openCreateForm}>+ Add User</button>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{form.id ? 'Edit User' : 'Add User'}</h2>

            {formError && <div className="alert alert-error">{formError}</div>}

            <div className="form-grid">
              <label>
                Username
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </label>
              <label>
                Full Name
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </label>
              <label>
                {form.id ? 'New Password (leave blank to keep current)' : 'Password'}
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </label>
              <label>
                Role
                <select
                  value={form.role_id}
                  onChange={(e) => setForm({ ...form, role_id: e.target.value === '' ? '' : Number(e.target.value) })}
                >
                  <option value="">Select role</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
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
              <button onClick={handleSave} disabled={saving || !form.username.trim() || !form.role_id}>
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
                <th>Username</th>
                <th>Full Name</th>
                <th>Role</th>
                <th>Active</th>
                {(canEdit || canDelete) && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.full_name}</td>
                  <td>{u.role_name}</td>
                  <td>{u.is_active ? 'Yes' : 'No'}</td>
                  {(canEdit || canDelete) && (
                    <td className="table-actions">
                      {canEdit && <button onClick={() => openEditForm(u)}>Edit</button>}
                      {canDelete && (
                        <button onClick={() => handleDelete(u)} className="btn-danger">
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={canEdit || canDelete ? 5 : 4} className="empty-row">
                    No users found.
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
