import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Loader2 } from 'lucide-react';
import { apiErrorMessage, createSavedView } from '@/lib/api';
import { useToast } from '@/hooks/useToast';

/** Saves the current filters / sort / view of this page (its URL query) to the sidebar. */
export function SaveViewButton({ suggestedName }: { suggestedName?: string }) {
  const { pathname, search } = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const save = useMutation({
    mutationFn: () => createSavedView({ name: name.trim(), path: pathname, query: search }),
    onSuccess: (view) => {
      queryClient.invalidateQueries({ queryKey: ['saved-views'] });
      toast(`Saved "${view.name}" to the sidebar`, 'success');
      setOpen(false);
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not save the view'), 'error'),
  });

  useEffect(() => {
    if (!open) return;
    setName(suggestedName ?? '');
    const close = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open, suggestedName]);

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Save these filters as a view in the sidebar"
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors"
      >
        <Bookmark className="w-4 h-4" />
        Save view
      </button>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
          className="absolute right-0 mt-1 w-72 z-30 rounded-md border border-border bg-card shadow-lg p-3 space-y-2"
        >
          <label className="block text-xs font-medium">View name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Critical drafts from Elastic"
            className="w-full px-2.5 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p className="text-[11px] text-muted-foreground">Saves the current filters, search and sort. It appears under “Saved views” in the sidebar.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-accent">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || save.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            >
              {save.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
