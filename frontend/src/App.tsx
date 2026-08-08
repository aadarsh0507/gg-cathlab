import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Navbar } from './components/Navbar';
import { LoginPage } from './pages/LoginPage';
import { ItemsPage } from './pages/ItemsPage';
import { MastersPage } from './pages/MastersPage';
import { UsersPage } from './pages/UsersPage';
import { RolesPage } from './pages/RolesPage';
import { InvoiceCreatePage } from './pages/InvoiceCreatePage';
import { InvoiceListPage } from './pages/InvoiceListPage';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage';
import { InvoiceEditPage } from './pages/InvoiceEditPage';
import { InvoicePrint } from './pages/InvoicePrint';
import { VendorDocumentsReportPage } from './pages/VendorDocumentsReportPage';
import { InvoiceReportPage } from './pages/InvoiceReportPage';
import { VendorDocumentEntryPage } from './pages/VendorDocumentEntryPage';
import { ApprovalLevelsPage } from './pages/ApprovalLevelsPage';
import { AuditLogPage } from './pages/AuditLogPage';
import './App.css';

function AppLayout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="page-loading">Loading...</div>;
  }

  return (
    <>
      <Navbar />
      <main className={user ? 'main-content' : 'main-content-full'}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Navigate to="/invoices" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices"
            element={
              <ProtectedRoute requireScreen="invoices">
                <InvoiceListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices/new"
            element={
              <ProtectedRoute requireScreen="invoices">
                <InvoiceCreatePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices/:id"
            element={
              <ProtectedRoute requireScreen="invoices">
                <InvoiceDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices/:id/edit"
            element={
              <ProtectedRoute requireScreen="invoices">
                <InvoiceEditPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices/:id/print"
            element={
              <ProtectedRoute requireScreen="invoices">
                <InvoicePrint />
              </ProtectedRoute>
            }
          />
          <Route
            path="/items"
            element={
              <ProtectedRoute requireScreen="items">
                <ItemsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute requireScreen="users">
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/roles"
            element={
              <ProtectedRoute requireScreen="roles">
                <RolesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/masters"
            element={
              <ProtectedRoute>
                <MastersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendor-documents/entry"
            element={
              <ProtectedRoute requireScreen="vendor_documents">
                <VendorDocumentEntryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/invoices"
            element={
              <ProtectedRoute requireScreen="reports">
                <InvoiceReportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/vendor-documents"
            element={
              <ProtectedRoute requireScreen="reports">
                <VendorDocumentsReportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/approval-levels"
            element={
              <ProtectedRoute requireScreen="approval_levels">
                <ApprovalLevelsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit-log"
            element={
              <ProtectedRoute requireScreen="audit_log">
                <AuditLogPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
