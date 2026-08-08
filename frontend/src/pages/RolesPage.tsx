import { useEffect, useState } from 'react';
import { apiClient, extractErrorMessage } from '../api/client';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../context/AuthContext';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { SCREEN_LABELS, SCREEN_LIST } from '../types';
import type { PermissionMatrix, Role, Screen, ScreenPermission } from '../types';

const emptyForm = { id: 0, name: '', description: '', is_active: true };

const emptyPermission: ScreenPermission = { can_view: false, can_create: false, can_edit: false, can_delete: false };

function buildFullMatrix(permissions: PermissionMatrix): Record<Screen, ScreenPermission> {
  const matrix = {} as Record<Screen, ScreenPermission>;
  for (const screen of SCREEN_LIST) {
    matrix[screen] = permissions[screen] ? { ...permissions[screen] } as ScreenPermission : { ...emptyPermission };
  }
  return matrix;
}

export function RolesPage() {
  const { can } = useAuth();
  const canCreate = can('roles', 'create');
  const canEdit = can('roles', 'edit');
  const canDelete = can('roles', 'delete');

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { pageItems, page, totalPages, setPage } = usePaginatedList(roles, 20);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingPermissionsFor, setEditingPermissionsFor] = useState<Role | null>(null);
  const [matrix, setMatrix] = useState<Record<Screen, ScreenPermission>>(buildFullMatrix({}));
  const [savingMatrix, setSavingMatrix] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<Role[]>('/roles');
      setRoles(data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load roles.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreateForm = () => {
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (role: Role) => {
    setForm({ id: role.id, name: role.name, description: role.description || '', is_active: !!role.is_active });
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormError(null);
  };

  const handleSaveRole = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const payload = { name: form.name, description: form.description || null, is_active: form.is_active };
      if (form.id) {
        await apiClient.put(`/roles/${form.id}`, payload);
      } else {
        await apiClient.post('/roles', payload);
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Failed to save role.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async (role: Role) => {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    setError(null);
    try {
      await apiClient.delete(`/roles/${role.id}`);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to delete role.'));
    }
  };

  const openPermissionsEditor = (role: Role) => {
    setEditingPermissionsFor(role);
    setMatrix(buildFullMatrix(role.permissions));
    setMatrixError(null);
  };

  const closePermissionsEditor = () => {
    setEditingPermissionsFor(null);
    setMatrixError(null);
  };

  const toggleCell = (screen: Screen, action: keyof ScreenPermission) => {
    setMatrix((prev) => ({
      ...prev,
      [screen]: { ...prev[screen], [action]: !prev[screen][action] },
    }));
  };

  const handleSaveMatrix = async () => {
    if (!editingPermissionsFor) return;
    setSavingMatrix(true);
    setMatrixError(null);
    try {
      await apiClient.put(`/roles/${editingPermissionsFor.id}/permissions`, { permissions: matrix });
      setEditingPermissionsFor(null);
      await load();
    } catch (err) {
      setMatrixError(extractErrorMessage(err, 'Failed to save permissions.'));
    } finally {
      setSavingMatrix(false);
    }
  };

  const permissionSummary = (role: Role) => {
    const screensWithAccess = SCREEN_LIST.filter((s) => role.permissions[s]?.can_view);
    if (screensWithAccess.length === 0) return 'No screen access';
    return screensWithAccess.map((s) => SCREEN_LABELS[s]).join(', ');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Roles</h1>
        {canCreate && <button onClick={openCreateForm}>+ Add Role</button>}
      </div>

      <p className="hint">
        Create roles and set which screens each role can view, and whether they can create, edit, or delete on each
        one.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{form.id ? 'Edit Role' : 'Add Role'}</h2>

            {formError && <div className="alert alert-error">{formError}</div>}

            <div className="form-grid">
              <label>
                Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Description
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
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
              <button onClick={handleSaveRole} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingPermissionsFor && (
        <div className="modal-backdrop" onClick={closePermissionsEditor}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Screen Rights — {editingPermissionsFor.name}</h2>

            {matrixError && <div className="alert alert-error">{matrixError}</div>}

            <table className="data-table">
              <thead>
                <tr>
                  <th>Screen</th>
                  <th>View</th>
                  <th>Create</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {SCREEN_LIST.map((screen) => (
                  <tr key={screen}>
                    <td>{SCREEN_LABELS[screen]}</td>
                    {(['can_view', 'can_create', 'can_edit', 'can_delete'] as const).map((action) => (
                      <td key={action}>
                        <input
                          type="checkbox"
                          checked={matrix[screen][action]}
                          onChange={() => toggleCell(screen, action)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="modal-actions">
              <button onClick={closePermissionsEditor} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleSaveMatrix} disabled={savingMatrix}>
                {savingMatrix ? 'Saving...' : 'Save'}
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
                <th>Description</th>
                <th>Screen Access</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((role) => (
                <tr key={role.id}>
                  <td>{role.name}</td>
                  <td>{role.description || '-'}</td>
                  <td>{permissionSummary(role)}</td>
                  <td>{role.is_active ? 'Yes' : 'No'}</td>
                  <td className="table-actions">
                    {canEdit && <button onClick={() => openPermissionsEditor(role)}>Screen Rights</button>}
                    {canEdit && <button onClick={() => openEditForm(role)}>Edit</button>}
                    {canDelete && role.name !== 'admin' && (
                      <button onClick={() => handleDeleteRole(role)} className="btn-danger">
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {roles.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-row">
                    No roles found.
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
