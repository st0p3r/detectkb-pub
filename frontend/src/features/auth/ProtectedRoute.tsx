import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

interface ProtectedRouteProps {
  children?: React.ReactNode;
}

/**
 * Wraps routes that require authentication.
 * Redirects unauthenticated users to /login.
 * Renders children or <Outlet /> for authenticated users.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, mustChangePassword } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
