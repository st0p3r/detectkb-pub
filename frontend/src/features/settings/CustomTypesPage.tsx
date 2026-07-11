import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Tag, Plus, Trash2, ChevronLeft, Lock } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listPageTypes, createPageType, deletePageType } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const PRESET_COLORS = [
  '#64748b', '#7c3aed', '#0891b2', '#4338ca', '#d97706',
  '#dc2626', '#16a34a', '#0d9488', '#db2777', '#ea580c',
];

export function CustomTypesPage() {
  const qc = useQueryClient();
  const { data: types = [], isLoading } = useQuery({
    queryKey: ['page-types'],
    queryFn: listPageTypes,
  });

  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [createError, setCreateError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createPageType,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['page-types'] });
      setName('');
      setLabel('');
      setColor('#6366f1');
      setCreateError('');
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      setCreateError(e.response?.data?.error ?? 'Failed to create type');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePageType,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['page-types'] });
      setConfirmDelete(null);
    },
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !label.trim()) return;
    setCreateError('');
    createMutation.mutate({ name: name.trim(), label: label.trim(), color });
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/settings"
          className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <Tag className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Page Types</h1>
      </div>

      {/* Create form */}
      <div className="rounded-lg border border-border bg-card p-5 mb-6">
        <h2 className="text-sm font-semibold mb-4">Add Custom Type</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Internal name (e.g. PLAYBOOK)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                placeholder="MY_TYPE"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Display label
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="My Type"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Color</label>
            <div className="flex flex-wrap gap-2 items-center">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? '#fff' : 'transparent',
                    boxShadow: color === c ? `0 0 0 2px ${c}` : undefined,
                  }}
                  title={c}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border border-border"
                title="Custom color"
              />
              <span className="text-xs text-muted-foreground font-mono">{color}</span>
              <span
                className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium text-white ml-2"
                style={{ backgroundColor: color }}
              >
                {label || 'Preview'}
              </span>
            </div>
          </div>

          {createError && (
            <p className="text-sm text-destructive">{createError}</p>
          )}

          <button
            type="submit"
            disabled={!name.trim() || !label.trim() || createMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {createMutation.isPending ? 'Adding…' : 'Add Type'}
          </button>
        </form>
      </div>

      {/* Type list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Label</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Color</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Built-in</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.name} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs">{t.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white"
                      style={{ backgroundColor: t.color }}
                    >
                      {t.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded-full border border-border"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="font-mono text-xs text-muted-foreground">{t.color}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {t.isBuiltIn ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock className="w-3 h-3" />
                        Yes
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!t.isBuiltIn && (
                      <button
                        onClick={() => setConfirmDelete(t.name)}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-destructive/50 outline-none"
                        title="Delete type"
                        aria-label={`Delete ${t.label}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Page Type"
        message={`Delete type "${confirmDelete}"? Pages using this type will keep their current type value but the badge may not display correctly.`}
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
