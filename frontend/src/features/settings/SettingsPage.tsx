import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings, User, Lock, CheckCircle, AlertCircle, Users, Tag, Layers, ChevronRight } from 'lucide-react';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthContext';
import { api } from '@/lib/api';

type PasswordStatus = 'idle' | 'loading' | 'success' | 'error';

export function SettingsPage() {
  const { username, roles, passwordChanged } = useAuth();
  const isAdmin = roles.includes('admin');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<PasswordStatus>('idle');
  const [passwordError, setPasswordError] = useState('');

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');

    if (newPassword.length < 10) {
      setPasswordError('New password must be at least 10 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setPasswordStatus('loading');
    try {
      const res = await api.put<{ token?: string }>('/api/auth/password', { currentPassword, newPassword });
      passwordChanged(res.data.token);
      setPasswordStatus('success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to change password.';
      setPasswordError(msg);
      setPasswordStatus('error');
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Settings' }]} />

      <div className="flex items-center gap-3 mb-8">
        <Settings className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      {/* Account section */}
      <section className="rounded-lg border border-border bg-card p-6 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <User className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-medium">Account</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-primary font-semibold text-sm uppercase">
              {username?.charAt(0) ?? 'A'}
            </span>
          </div>
          <div>
            <p className="font-medium">{username ?? 'admin'}</p>
            <div className="flex gap-1 mt-0.5">
              {roles.map((r) => (
                <span key={r} className="px-1.5 py-0.5 rounded text-xs bg-primary/10 text-primary font-medium">{r}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Admin tools */}
      {isAdmin && (
        <section className="rounded-lg border border-border bg-card p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-medium">Administration</h2>
          </div>
          <div className="space-y-2">
            <Link
              to="/settings/users"
              className="flex items-center justify-between px-4 py-3 rounded-md border border-border hover:bg-accent transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">User Management</p>
                  <p className="text-xs text-muted-foreground">Create, edit, and manage user accounts and roles</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
            </Link>
            <Link
              to="/settings/tags"
              className="flex items-center justify-between px-4 py-3 rounded-md border border-border hover:bg-accent transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Tag className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Tag Management</p>
                  <p className="text-xs text-muted-foreground">Create and manage tags with custom colors</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
            </Link>
            <Link
              to="/settings/types"
              className="flex items-center justify-between px-4 py-3 rounded-md border border-border hover:bg-accent transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Page Types</p>
                  <p className="text-xs text-muted-foreground">Add custom page types beyond the built-in ones</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
            </Link>
          </div>
        </section>
      )}


      {/* Change password section */}
      <section className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-5">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-medium">Change Password</h2>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="current-password">
              Current Password
            </label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="new-password">
              New Password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={10}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="confirm-password">
              Confirm New Password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {passwordStatus === 'success' && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              Password changed successfully.
            </div>
          )}

          {passwordError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {passwordError}
            </div>
          )}

          <Button
            type="submit"
            disabled={passwordStatus === 'loading'}
            className="mt-2"
          >
            {passwordStatus === 'loading' ? 'Saving...' : 'Change Password'}
          </Button>
        </form>
      </section>
    </div>
  );
}
