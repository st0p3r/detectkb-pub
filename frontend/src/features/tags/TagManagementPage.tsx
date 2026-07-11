import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import { listTagsAll, createTag, updateTag, deleteTag, type TagDetail } from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const PRESET_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

const CATEGORIES = ['severity', 'status', 'technique', 'team', 'custom'];

interface TagFormProps {
  initial?: Partial<TagDetail>;
  onSave: (data: { name: string; color: string; description?: string; category?: string }) => void;
  onCancel: () => void;
  loading?: boolean;
}

function TagForm({ initial, onSave, onCancel, loading }: TagFormProps) {
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || '#3B82F6');
  const [description, setDescription] = useState(initial?.description || '');
  const [category, setCategory] = useState(initial?.category || '');

  return (
    <div className="border border-border rounded-lg p-4 bg-muted/30">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium mb-1">Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Critical"
            className="w-full px-2.5 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">— None —</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="w-full px-2.5 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs font-medium mb-2">Color</label>
        <div className="flex flex-wrap gap-2 items-center">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: c,
                borderColor: color === c ? '#000' : 'transparent',
                outline: color === c ? '2px solid white' : 'none',
                outlineOffset: '-2px',
              }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border border-border"
            title="Custom color"
          />
          <span className="text-xs font-mono text-muted-foreground">{color}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="px-3 py-1 rounded-full text-xs font-medium text-white"
          style={{ backgroundColor: color }}
        >
          {name || 'Preview'}
        </div>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded border border-border text-sm text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave({ name: name.trim(), color, description: description.trim() || undefined, category: category || undefined })}
          disabled={loading || !name.trim()}
          className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Saving…' : initial?.id ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  );
}

export function TagManagementPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingTag, setEditingTag] = useState<TagDetail | null>(null);
  const [deletingTag, setDeletingTag] = useState<TagDetail | null>(null);
  const [filterCategory, setFilterCategory] = useState('');

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['tags-all'],
    queryFn: listTagsAll,
  });

  const createMutation = useMutation({
    mutationFn: createTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags-all'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setShowCreate(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateTag>[1] }) =>
      updateTag(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags-all'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setEditingTag(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags-all'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setDeletingTag(null);
    },
  });

  const displayed = filterCategory ? tags.filter((t) => t.category === filterCategory) : tags;

  return (
    <div className="max-w-4xl mx-auto">
      <Breadcrumbs items={[{ label: 'Settings', to: '/settings' }, { label: 'Tag Management' }]} />
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Tag className="w-6 h-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Tag Management</h1>
        </div>
        <button
          onClick={() => { setShowCreate((v) => !v); setEditingTag(null); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Tag
        </button>
      </div>

      {showCreate && !editingTag && (
        <div className="mb-6">
          <TagForm
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setShowCreate(false)}
            loading={createMutation.isPending}
          />
        </div>
      )}

      {/* Category filter */}
      <div className="flex gap-1 flex-wrap mb-4">
        <button
          onClick={() => setFilterCategory('')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${!filterCategory ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground'}`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setFilterCategory(filterCategory === c ? '' : c)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filterCategory === c ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground'}`}
          >
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading tags…</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No tags yet. Create your first tag to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayed.map((tag) => (
            <div key={tag.id}>
              {editingTag?.id === tag.id ? (
                <TagForm
                  initial={tag}
                  onSave={(data) => updateMutation.mutate({ id: tag.id, data })}
                  onCancel={() => setEditingTag(null)}
                  loading={updateMutation.isPending}
                />
              ) : (
                <div className="group border border-border rounded-lg p-3 bg-card hover:shadow-sm transition-shadow flex items-start gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
                    style={{ backgroundColor: tag.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{tag.name}</span>
                      <span
                        className="px-2 py-0.5 rounded-full text-xs text-white flex-shrink-0"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag._count?.pages ?? 0} pages
                      </span>
                    </div>
                    {tag.category && (
                      <span className="text-xs text-muted-foreground capitalize">{tag.category}</span>
                    )}
                    {tag.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{tag.description}</p>
                    )}
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => { setEditingTag(tag); setShowCreate(false); }}
                      className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit tag"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingTag(tag)}
                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete tag"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deletingTag !== null}
        title="Delete Tag"
        message={`Delete tag "${deletingTag?.name}"? It will be removed from all pages.`}
        confirmLabel="Delete"
        onConfirm={() => deletingTag && deleteMutation.mutate(deletingTag.id)}
        onCancel={() => setDeletingTag(null)}
      />
    </div>
  );
}
