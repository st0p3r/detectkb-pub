import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Shield, RefreshCw, KeyRound, X, Check } from 'lucide-react';
import {
  listUsers, listRoles, createUser, updateUserRoles, toggleUser, resetUserPassword,
  type UserData, type RoleData,
} from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { relativeTime } from '@/lib/time';

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  editor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  viewer: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

interface CreateUserFormProps {
  roles: RoleData[];
  onDone: () => void;
}

function CreateUserForm({ roles, onDone }: CreateUserFormProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ username: '', email: '', password: '', firstName: '', lastName: '' });
  const [selectedRoles, setSelectedRoles] = useState<number[]>([]);

  const mutation = useMutation({
    mutationFn: () =>
      createUser({ ...form, roleIds: selectedRoles }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onDone();
    },
  });

  function toggleRole(id: number) {
    setSelectedRoles((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]);
  }

  return (
    <div className="border border-border rounded-lg p-4 mb-6 bg-muted/30">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Create New User</h3>
        <button onClick={onDone} className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {(['username', 'email', 'password', 'firstName', 'lastName'] as const).map((field) => (
          <div key={field} className={field === 'email' || field === 'password' ? 'col-span-2 sm:col-span-1' : ''}>
            <label className="block text-xs font-medium mb-1 capitalize">{field === 'firstName' ? 'First Name' : field === 'lastName' ? 'Last Name' : field}</label>
            <input
              type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
              value={form[field]}
              onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              required={['username', 'email', 'password'].includes(field)}
              className="w-full px-2.5 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        ))}
      </div>
      <div className="mb-4">
        <label className="block text-xs font-medium mb-2">Roles</label>
        <div className="flex gap-2 flex-wrap">
          {roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => toggleRole(role.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedRoles.includes(role.id)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              {role.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onDone} className="px-3 py-1.5 rounded border border-border text-sm text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !form.username || !form.email || !form.password}
          className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {mutation.isPending ? 'Creating…' : 'Create User'}
        </button>
      </div>
      {mutation.error && (
        <p className="text-sm text-destructive mt-2">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

interface EditRolesDialogProps {
  user: UserData;
  roles: RoleData[];
  onClose: () => void;
}

function EditRolesDialog({ user, roles, onClose }: EditRolesDialogProps) {
  const queryClient = useQueryClient();
  const [selectedRoles, setSelectedRoles] = useState<number[]>(
    user.userRoles.map((ur) => ur.role.id)
  );

  const mutation = useMutation({
    mutationFn: () => updateUserRoles(user.id, selectedRoles),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });

  function toggleRole(id: number) {
    setSelectedRoles((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm bg-card rounded-lg border border-border shadow-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Edit Roles — {user.username}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 flex-wrap mb-4">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => toggleRole(role.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                selectedRoles.includes(role.id)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              {selectedRoles.includes(role.id) && <Check className="w-3 h-3 inline mr-1" />}
              {role.name}
            </button>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-border text-sm text-muted-foreground hover:bg-accent">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Save Roles'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ResetPasswordDialogProps {
  user: UserData;
  onClose: () => void;
}

function ResetPasswordDialog({ user, onClose }: ResetPasswordDialogProps) {
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => resetUserPassword(user.id, newPassword),
    onSuccess: () => setDone(true),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm bg-card rounded-lg border border-border shadow-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Reset Password — {user.username}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        {done ? (
          <div className="text-sm text-green-600 mb-4 flex items-center gap-2">
            <Check className="w-4 h-4" /> Password reset successfully
          </div>
        ) : (
          <>
            <input
              type="password"
              placeholder="New password (min 10 chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 mb-4"
            />
            {mutation.error && <p className="text-sm text-destructive mb-2">{(mutation.error as Error).message}</p>}
          </>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-border text-sm text-muted-foreground hover:bg-accent">
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || newPassword.length < 10}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {mutation.isPending ? 'Resetting…' : 'Reset'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function UserManagementPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingRoles, setEditingRoles] = useState<UserData | null>(null);
  const [resettingPassword, setResettingPassword] = useState<UserData | null>(null);
  const [togglingUser, setTogglingUser] = useState<UserData | null>(null);

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: listRoles,
  });

  const toggleMutation = useMutation({
    mutationFn: (user: UserData) => toggleUser(user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setTogglingUser(null);
    },
  });

  return (
    <div className="max-w-5xl mx-auto">
      <Breadcrumbs items={[{ label: 'Settings', to: '/settings' }, { label: 'User Management' }]} />
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New User
        </button>
      </div>

      {showCreate && (
        <CreateUserForm roles={roles} onDone={() => setShowCreate(false)} />
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Roles</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Created</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {usersLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No users found</td>
              </tr>
            ) : users.map((user) => (
              <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-xs flex-shrink-0">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium">{user.username}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {user.userRoles.map((ur) => (
                      <span
                        key={ur.role.id}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[ur.role.name] || 'bg-muted text-muted-foreground'}`}
                      >
                        {ur.role.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">
                  {relativeTime(user.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    user.isActive
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
                  }`}>
                    {user.isActive ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => setEditingRoles(user)}
                      title="Edit roles"
                      className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Shield className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setResettingPassword(user)}
                      title="Reset password"
                      className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setTogglingUser(user)}
                      title={user.isActive ? 'Disable user' : 'Enable user'}
                      className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingRoles && (
        <EditRolesDialog user={editingRoles} roles={roles} onClose={() => setEditingRoles(null)} />
      )}
      {resettingPassword && (
        <ResetPasswordDialog user={resettingPassword} onClose={() => setResettingPassword(null)} />
      )}
      <ConfirmDialog
        open={togglingUser !== null}
        title={togglingUser?.isActive ? 'Disable User' : 'Enable User'}
        message={`${togglingUser?.isActive ? 'Disable' : 'Enable'} user "${togglingUser?.username}"?`}
        confirmLabel={togglingUser?.isActive ? 'Disable' : 'Enable'}
        onConfirm={() => togglingUser && toggleMutation.mutate(togglingUser)}
        onCancel={() => setTogglingUser(null)}
      />
    </div>
  );
}
