import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, Wand2 } from 'lucide-react';
import { apiErrorMessage, createDataSourcePages, planDataSourcePages } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';

/** Sources with at least this many rules are ticked by default */
const DEFAULT_MIN_RULES = 5;

/**
 * Log sources the rules read that no data source page describes yet, with a
 * button that creates the pages (linked to the events the rules use).
 */
export function DataSourcePlanner({ onCreated }: { onCreated: () => void }) {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['data-source-plan'], queryFn: planDataSourcePages });
  const missing = useMemo(() => (data ?? []).filter((p) => !p.pages.length), [data]);
  const selected = picked ?? new Set(missing.filter((p) => p.rules >= DEFAULT_MIN_RULES).map((p) => p.source));

  const create = useMutation({
    mutationFn: () => createDataSourcePages(Array.from(selected)),
    onSuccess: ({ created }) => {
      toast(`${created.length} data source page${created.length === 1 ? '' : 's'} created`, 'success');
      setPicked(null);
      qc.invalidateQueries({ queryKey: ['data-source-plan'] });
      qc.invalidateQueries({ queryKey: ['data-health'] });
      qc.invalidateQueries({ queryKey: ['pages'] });
      onCreated();
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not create the pages'), 'error'),
  });

  if (isLoading || !missing.length) return null;
  const toggle = (source: string) => {
    const next = new Set(selected);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    setPicked(next);
  };
  const canCreate = hasPermission('pages:create');

  return (
    <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm" aria-expanded={open}>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <span>
          <b>{missing.length}</b> log source{missing.length === 1 ? '' : 's'} your rules read {missing.length === 1 ? 'has' : 'have'} no data source page
          {' '}({missing.reduce((n, p) => n + p.rules, 0).toLocaleString()} rule links). A page lets impact analysis answer “what if we stop collecting
          it?” and gives the team one place to note where it is collected.
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 mb-3">
            {missing.map((p) => (
              <li key={p.source}>
                <label className="flex items-center gap-2 text-sm" title={p.events.map((e) => `${e.label} (${e.rules})`).join('\n')}>
                  {canCreate && <input type="checkbox" checked={selected.has(p.source)} onChange={() => toggle(p.source)} />}
                  <span className="truncate">{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.platform}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {p.rules} rule{p.rules === 1 ? '' : 's'} · {p.events.length} event{p.events.length === 1 ? '' : 's'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {canCreate && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => create.mutate()}
                disabled={!selected.size || create.isPending}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Create {selected.size} page{selected.size === 1 ? '' : 's'}
              </button>
              <span className="text-xs text-muted-foreground">
                Each page lists the events rules use and is linked to them; fill in where and how it is collected afterwards. See also{' '}
                <Link to="/log-sources" className="text-primary hover:underline">
                  Log Sources
                </Link>
                .
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
