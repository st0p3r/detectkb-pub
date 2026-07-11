import React from 'react';
import { useAuth } from '@/features/auth/AuthContext';

interface ProtectedComponentProps {
  requiredPermission?: string;
  requiredRole?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function ProtectedComponent({
  requiredPermission,
  requiredRole,
  fallback = null,
  children,
}: ProtectedComponentProps) {
  const auth = useAuth();

  let hasAccess = true;
  if (requiredPermission) hasAccess = auth.hasPermission(requiredPermission);
  else if (requiredRole) hasAccess = auth.hasRole(requiredRole);

  return hasAccess ? <>{children}</> : <>{fallback}</>;
}
