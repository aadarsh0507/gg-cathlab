import { useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Navbar() {
  const { user, logout, canView } = useAuth();
  const navigate = useNavigate();
  const [reportsOpen, setReportsOpen] = useState(false);
  const reportsCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openReports = () => {
    if (reportsCloseTimer.current) clearTimeout(reportsCloseTimer.current);
    setReportsOpen(true);
  };
  const closeReports = () => {
    reportsCloseTimer.current = setTimeout(() => setReportsOpen(false), 120);
  };

  if (!user) return null;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <img src="/logo.png" alt="GG Signature" className="navbar-logo" />
      </div>
      <div className="navbar-links">
        {canView('invoices') && (
          <>
            <NavLink to="/invoices" className={({ isActive }) => (isActive ? 'active' : '')}>
              Invoices
            </NavLink>
            <NavLink to="/invoices/new" className={({ isActive }) => (isActive ? 'active' : '')}>
              New Invoice
            </NavLink>
          </>
        )}
        {canView('items') && (
          <NavLink to="/items" className={({ isActive }) => (isActive ? 'active' : '')}>
            Item Master
          </NavLink>
        )}
        {canView('vendor_documents') && (
          <NavLink to="/vendor-documents/entry" className={({ isActive }) => (isActive ? 'active' : '')}>
            Vendor Docs
          </NavLink>
        )}
        {canView('reports') && (
          <div
            className="navbar-dropdown"
            onMouseEnter={openReports}
            onMouseLeave={closeReports}
          >
            <span className={`navbar-dropdown-trigger${reportsOpen ? ' active' : ''}`}>
              Reports ▾
            </span>
            {reportsOpen && (
              <div className="navbar-dropdown-menu">
                <NavLink to="/reports/invoices" onClick={() => setReportsOpen(false)}>
                  Invoice Report
                </NavLink>
                <NavLink to="/reports/vendor-documents" onClick={() => setReportsOpen(false)}>
                  Vendor Documents
                </NavLink>
              </div>
            )}
          </div>
        )}
        {canView('users') && (
          <NavLink to="/users" className={({ isActive }) => (isActive ? 'active' : '')}>
            Users
          </NavLink>
        )}
        {(canView('categories') || canView('units') || canView('vendors')) && (
          <NavLink to="/masters" className={({ isActive }) => (isActive ? 'active' : '')}>
            Masters
          </NavLink>
        )}
        {canView('approval_levels') && (
          <NavLink to="/approval-levels" className={({ isActive }) => (isActive ? 'active' : '')}>
            Approval Levels
          </NavLink>
        )}
        {canView('roles') && (
          <NavLink to="/roles" className={({ isActive }) => (isActive ? 'active' : '')}>
            Roles
          </NavLink>
        )}
        {canView('audit_log') && (
          <NavLink to="/audit-log" className={({ isActive }) => (isActive ? 'active' : '')}>
            Audit Log
          </NavLink>
        )}
      </div>
      <div className="navbar-user">
        <span>
          {user.full_name} <em>({user.role_name})</em>
        </span>
        <button onClick={handleLogout}>Logout</button>
      </div>
    </nav>
  );
}
