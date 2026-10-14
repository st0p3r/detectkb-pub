import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Search, X } from 'lucide-react';
import { apiErrorMessage, bulkUpdateRules, compareRules, listSimilarRules, type ComparedRule, type SimilarGroup } from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SourceBadge } from '@/components/ui/SourceBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { useDebounced } from '@/hooks/useDebounced';
import { cn } from '@/lib/utils';

const MIN_OPTIONS = [
  { value: 0.9, label: '90% alike or more' },
  { value: 0.7, label: '70% alike or more' },
  { value: 0.5, label: '50% alike or more' },
  { value: 0, label: 'Any similarity' },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;

function similarityClass(s: number) {
  if (s >= 0.9) return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30';
  if (s >= 0.7) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30';
  return 'bg-muted text-muted-foreground border-border';
}

/** Words of a query, for showing what differs between two rules. */
const words = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9_.\\/-]{2,}/g) ?? []).map((w) => w.replace(/[.\\/-]+$/, '')));

function RuleColumn({ rule, only }: { rule: ComparedRule; only: string[] }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/pages/${rule.page.slug}`} className="font-medium text-primary hover:underline">
          {rule.page.title}
        </Link>
        {rule.sourceFormat && <SourceBadge source={rule.sourceFormat} />}
        <StatusBadge status={rule.status} />
      </div>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Techniques</dt>
        <dd className="font-mono">{rule.mitreTechniques || '—'}</dd>
        <dt className="text-muted-foreground">Data source</dt>
        <dd className="break-words">{rule.dataSource || '—'}</dd>
        <dt className="text-muted-foreground">False positives</dt>
        <dd className="break-words">{rule.falsePositives || '—'}</dd>
      </dl>
      {only.length > 0 && (
        <div className="text-xs">
          <span className="text-muted-foreground">Only in this rule: </span>
          {only.slice(0, 30).map((w) => (
            <span key={w} className="inline-block mr-1 mb-0.5 px-1 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300 font-mono">
              {w}
            </span>
          ))}
          {only.length > 30 && <span className="text-muted-foreground">+{only.length - 30}</span>}
        </div>
      )}
      {rule.splQuery && (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-snug whitespace-pre-wrap break-all">{rule.splQuery}</pre>
      )}
      {rule.nativeQuery && (
        <>
          <div className="text-xs text-muted-foreground">{rule.nativeLanguage ?? 'Native'} query</div>
          <pre className="max-h-60 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-snug whitespace-pre-wrap break-all">{rule.nativeQuery}</pre>
        </>
      )}
    </div>
  );
}

/** Two rules side by side, with the words each one has and the other doesn't. */
function CompareDialog({ pair, onClose }: { pair: [number, number]; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['compare-rules', pair], queryFn: () => compareRules(...pair) });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const diff = useMemo(() => {
    if (!data) return null;
    const [a, b] = data.map((r) => words(`${r.splQuery}\n${r.nativeQuery ?? ''}`));
    return [Array.from(a).filter((w) => !b.has(w)), Array.from(b).filter((w) => !a.has(w))];
  }, [data]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-6xl rounded-lg border border-border bg-card p-4 mt-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Compare rules</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </p>
        ) : error || !data || !diff ? (
          <p className="text-sm text-destructive">{apiErrorMessage(error)}</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <RuleColumn rule={data[0]} only={diff[0]} />
            <RuleColumn rule={data[1]} only={diff[1]} />
          </div>
        )}
      </div>
    </div>
  );
}

function GroupCard({ group, canUpdate, onCompare }: { group: SimilarGroup; canUpdate: boolean; onCompare: (pair: [number, number]) => void }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const title = useMemo(() => new Map(group.rules.map((r) => [r.pageId, r.title])), [group]);
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function deprecate() {
    setConfirm(false);
    setBusy(true);
    try {
      const { changed } = await bulkUpdateRules({ pageIds: Array.from(selected) }, 'status', 'deprecated');
      toast(`${changed} rule${changed === 1 ? '' : 's'} set to deprecated`, 'success');
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['similar-rules'] });
      qc.invalidateQueries({ queryKey: ['rules'] });
    } catch (err) {
      toast(apiErrorMessage(err, 'Could not change the rules'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border text-xs">
        <span className={cn('px-1.5 py-0.5 rounded border font-semibold tabular-nums', similarityClass(group.similarity))} title="Highest similarity between two of these rules">
          {pct(group.similarity)} alike
        </span>
        {group.techniques.map((t) => (
          <Link key={t} to={`/rules?technique=${t}`} className="font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:underline">
            {t}
          </Link>
        ))}
        <span className="text-muted-foreground truncate max-w-[36rem]" title={group.telemetry.map((t) => t.label).join(', ')}>
          reads {group.telemetry.map((t) => t.label).join(', ')}
        </span>
        {group.crossSource && <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400">from several sources</span>}
        {canUpdate && selected.size > 0 && (
          <button
            onClick={() => setConfirm(true)}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border font-medium hover:bg-accent disabled:opacity-50"
          >
            {busy && <Loader2 className="w-3 h-3 animate-spin" />}
            Set {selected.size} to deprecated
          </button>
        )}
      </div>
      <ul className="divide-y divide-border">
        {group.rules.map((r) => (
          <li key={r.pageId} className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-sm">
            {canUpdate && (
              <input type="checkbox" checked={selected.has(r.pageId)} onChange={() => toggle(r.pageId)} aria-label={`Select ${r.title}`} />
            )}
            <Link to={`/pages/${r.slug}`} className="text-primary hover:underline min-w-0 truncate max-w-[30rem]">
              {r.title}
            </Link>
            {r.sourceFormat && <SourceBadge source={r.sourceFormat} />}
            <StatusBadge status={r.status} />
            {r.closest && (
              <button
                onClick={() => onCompare([r.pageId, r.closest!.pageId])}
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                title={`Compare with ${title.get(r.closest.pageId)}`}
              >
                <Copy className="w-3 h-3" />
                {pct(r.closest.similarity)} like <span className="truncate max-w-[16rem]">{title.get(r.closest.pageId)}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirm}
        title={`Deprecate ${selected.size} rule${selected.size === 1 ? '' : 's'}?`}
        message="Deprecated rules leave coverage, impact analysis and this list. The change is recorded in the audit log and can be undone from the Rules list."
        confirmLabel="Deprecate"
        onConfirm={deprecate}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

/** Rules with the same techniques and telemetry, to merge or retire overlapping detections. */
export function SimilarRulesPage() {
  const { hasPermission } = useAuth();
  const [min, setMin] = useState(0.7);
  const [crossSource, setCrossSource] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const [pair, setPair] = useState<[number, number] | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['similar-rules', min, crossSource, q],
    queryFn: () => listSimilarRules({ min, crossSource, q }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="max-w-6xl">
      <Breadcrumbs items={[{ label: 'Similar Rules' }]} />
      <div className="flex items-center gap-3 mb-5">
        <Copy className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Similar Rules</h1>
          <p className="text-sm text-muted-foreground">
            Active rules mapped to the same ATT&CK techniques and reading the same telemetry, compared by the words of their queries. Overlaps
            are not always duplicates — compare, then keep the better rule.
          </p>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            ['Groups', data.summary.groups],
            ['Rules in groups', data.summary.rules],
            [`At least ${pct(data.summary.likelyThreshold)} alike`, data.summary.likely],
            ['From several sources', data.summary.crossSource],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-semibold tabular-nums">{(value as number).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rule title or technique ID…"
            className="w-full pl-8 pr-3 py-2 rounded-md border border-border bg-background text-sm"
          />
        </div>
        <select value={min} onChange={(e) => setMin(Number(e.target.value))} aria-label="Minimum similarity" className="px-3 py-2 rounded-md border border-border bg-background text-sm">
          {MIN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm cursor-pointer">
          <input type="checkbox" checked={crossSource} onChange={(e) => setCrossSource(e.target.checked)} />
          From several sources only
        </label>
        {data && <span className="text-xs text-muted-foreground">{data.matching.toLocaleString()} groups</span>}
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Comparing rules…
        </p>
      ) : error || !data ? (
        <p className="text-destructive text-sm">{apiErrorMessage(error)}</p>
      ) : data.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No group matches.</p>
      ) : (
        <div className="space-y-3">
          {data.groups.map((g) => (
            <GroupCard key={g.key} group={g} canUpdate={hasPermission('rules:update')} onCompare={setPair} />
          ))}
          {data.matching > data.groups.length && (
            <p className="text-xs text-muted-foreground">Showing the {data.groups.length} most similar groups of {data.matching.toLocaleString()}; narrow the search to see others.</p>
          )}
        </div>
      )}
      {pair && <CompareDialog pair={pair} onClose={() => setPair(null)} />}
    </div>
  );
}
