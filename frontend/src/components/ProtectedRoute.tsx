import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Screen } from '../types';

interface ProtectedRouteProps {
  children: ReactNode;
  requireScreen?: Screen;
}

export function ProtectedRoute({ children, requireScreen }: ProtectedRouteProps) {
  const { user, isLoading, canView } = useAuth();

  if (isLoading) {
    return <div className="page-loading">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireScreen && !canView(requireScreen)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
