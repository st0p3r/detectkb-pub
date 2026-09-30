import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from './AuthContext';

const inputClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** Shown (outside the main layout) when the account must replace its password. */
export function ChangePasswordPage() {
  const { isAuthenticated, mustChangePassword, passwordChanged, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!mustChangePassword) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 10) return setError('New password must be at least 10 characters.');
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');
    setLoading(true);
    try {
      const res = await api.put<{ token?: string }>('/api/auth/password', { currentPassword, newPassword });
      passwordChanged(res.data.token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change password.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <KeyRound className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Choose a new password</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">
            Your password was set by an administrator or is the default one. Replace it to continue.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { id: 'current', label: 'Current password', value: currentPassword, set: setCurrentPassword, auto: 'current-password' },
              { id: 'new', label: 'New password', value: newPassword, set: setNewPassword, auto: 'new-password' },
              { id: 'confirm', label: 'Confirm new password', value: confirmPassword, set: setConfirmPassword, auto: 'new-password' },
            ].map((f, i) => (
              <div key={f.id} className="space-y-1.5">
                <label htmlFor={f.id} className="text-sm font-medium text-foreground">
                  {f.label}
                </label>
                <input
                  id={f.id}
                  type="password"
                  autoComplete={f.auto}
                  autoFocus={i === 0}
                  required
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  className={inputClass}
                />
              </div>
            ))}

            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Change password
            </Button>
            <button type="button" onClick={logout} className="w-full text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
