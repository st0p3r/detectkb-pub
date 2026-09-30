import React, { createContext, useContext, useState, useCallback } from 'react';

interface AuthContextValue {
  token: string | null;
  username: string | null;
  roles: string[];
  permissions: string[];
  isAuthenticated: boolean;
  mustChangePassword: boolean;
  login: (
    token: string,
    username: string,
    roles?: string[],
    permissions?: string[],
    mustChangePassword?: boolean
  ) => void;
  /** After a password change: the server signed out other sessions and returned a new token. */
  passwordChanged: (newToken?: string) => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  isAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const t = localStorage.getItem('authToken');
    // Old tokens (pre-RBAC) lack authRoles — force re-login so JWT has userId/roles
    if (t && !localStorage.getItem('authRoles')) {
      localStorage.removeItem('authToken');
      localStorage.removeItem('authUsername');
      return null;
    }
    return t;
  });
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem('authUsername'));
  const [roles, setRoles] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('authRoles') || '[]'); } catch { return []; }
  });
  const [permissions, setPermissions] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('authPermissions') || '[]'); } catch { return []; }
  });

  const [mustChangePassword, setMustChangePassword] = useState<boolean>(
    () => localStorage.getItem('authMustChangePassword') === 'true'
  );

  const login = useCallback(
    (
      newToken: string,
      newUsername: string,
      newRoles: string[] = [],
      newPermissions: string[] = [],
      newMustChangePassword = false
    ) => {
      localStorage.setItem('authToken', newToken);
      localStorage.setItem('authMustChangePassword', String(newMustChangePassword));
      setMustChangePassword(newMustChangePassword);
      localStorage.setItem('authUsername', newUsername);
      localStorage.setItem('authRoles', JSON.stringify(newRoles));
      localStorage.setItem('authPermissions', JSON.stringify(newPermissions));
      setToken(newToken);
      setUsername(newUsername);
      setRoles(newRoles);
      setPermissions(newPermissions);
    },
    []
  );

  const passwordChanged = useCallback((newToken?: string) => {
    if (newToken) {
      localStorage.setItem('authToken', newToken);
      setToken(newToken);
    }
    localStorage.removeItem('authMustChangePassword');
    setMustChangePassword(false);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('authMustChangePassword');
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUsername');
    localStorage.removeItem('authRoles');
    localStorage.removeItem('authPermissions');
    setToken(null);
    setUsername(null);
    setRoles([]);
    setPermissions([]);
    window.location.href = '/login';
  }, []);

  const hasPermission = useCallback(
    (permission: string) => permissions.includes(permission) || roles.includes('admin'),
    [permissions, roles]
  );

  const hasRole = useCallback((role: string) => roles.includes(role), [roles]);

  const isAdmin = useCallback(() => roles.includes('admin'), [roles]);

  return (
    <AuthContext.Provider
      value={{
        token,
        username,
        roles,
        permissions,
        isAuthenticated: !!token,
        mustChangePassword,
        login,
        passwordChanged,
        logout,
        hasPermission,
        hasRole,
        isAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
