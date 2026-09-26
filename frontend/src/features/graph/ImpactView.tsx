import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, ShieldOff, Unplug } from 'lucide-react';
import { apiErrorMessage, getImpact, listPages, listSysmonEvents, type ImpactedRule } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/utils';

interface ImpactViewProps {
  events: number[];
  dataSource: number | null;
  onChange: (events: number[], dataSource: number | null) => void;
  onShowChain: (technique: string) => void;
}

const LEVELS: Record<ImpactedRule['level'], { label: string; hint: string; chip: string }> = {
  lost: { label: 'Lost', hint: 'Every Sysmon event it uses is gone and it lists no other source', chip: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30' },
  atRisk: {
    label: 'At risk',
    hint: 'Every Sysmon event it uses is gone; other sources it lists may still feed it',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
  partial: { label: 'Partial', hint: 'Some of its Sysmon events are gone', chip: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30' },
};

const LIST_STEP = 50;

/** "What if we stop collecting …?" — rules and techniques that depend on some telemetry. */
export function ImpactView({ events, dataSource, onChange, onShowChain }: ImpactViewProps) {
  const { data: sysmon = [] } = useQuery({ queryKey: ['sysmon-events'], queryFn: () => listSysmonEvents() });
  const { data: sources = [] } = useQuery({ queryKey: ['pages', 'DATA_SOURCE'], queryFn: () => listPages({ type: 'DATA_SOURCE' }) });
  const hasSelection = events.length > 0 || !!dataSource;
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['graph-impact', events, dataSource],
    queryFn: () => getImpact({ sysmon: events, dataSource: dataSource ?? undefined }),
    enabled: hasSelection,
  });
  const [level, setLevel] = useState<ImpactedRule['level'] | 'all'>('all');
  const [shown, setShown] = useState(LIST_STEP);

  const toggle = (id: number) => onChange(events.includes(id) ? events.filter((e) => e !== id) : [...events, id].sort((a, b) => a - b), dataSource);
  const rules = (data?.rules ?? []).filter((r) => level === 'all' || r.level === level);
  const covered = sysmon.filter((e) => e.ruleCount > 0);

  return (
    <div className="flex-1 min-h-0 overflow-auto space-y-4 pb-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Unplug className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">If we stop collecting…</span>
          <select
            value={dataSource ?? ''}
            onChange={(e) => onChange(events, e.target.value ? Number(e.target.value) : null)}
            aria-label="Data source"
            className="px-2.5 py-1.5 rounded-md border border-border bg-background text-sm"
          >
            <option value="">a data source (all its Sysmon events)…</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">and / or these Sysmon events:</span>
          {hasSelection && (
            <button onClick={() => onChange([], null)} className="text-xs text-primary hover:underline ml-auto">
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {covered.map((e) => {
            const on = events.includes(e.eventId) || !!data?.events.includes(e.eventId);
            return (
              <button
                key={e.eventId}
                onClick={() => toggle(e.eventId)}
                aria-pressed={events.includes(e.eventId)}
                title={`${e.name} — ${e.ruleCount} rules`}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors',
                  events.includes(e.eventId)
                    ? 'bg-red-500 text-white border-red-500'
                    : on
                      ? 'border-red-400 text-red-600 dark:text-red-400'
                      : 'border-border hover:bg-accent'
                )}
              >
                <span className="font-semibold tabular-nums">{e.eventId}</span>
                <span className="max-w-[10rem] truncate">{e.name}</span>
                <span className="opacity-70 tabular-nums">{e.ruleCount}</span>
              </button>
            );
          })}
        </div>
      </div>

      {!hasSelection ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Pick a data source or Sysmon events above to see which rules and ATT&CK techniques depend on them.
        </div>
      ) : isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground px-1">
          <Loader2 className="w-4 h-4 animate-spin" /> Analysing…
        </p>
      ) : error ? (
        <p className="text-sm text-destructive">{apiErrorMessage(error, 'Could not analyse')}</p>
      ) : data ? (
        <div className={cn('space-y-4 transition-opacity', isFetching && 'opacity-60')}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              ['Rules lost', data.counts.lost, 'text-red-600 dark:text-red-400', LEVELS.lost.hint],
              ['Rules at risk', data.counts.atRisk, 'text-amber-600 dark:text-amber-400', LEVELS.atRisk.hint],
              ['Rules degraded', data.counts.partial, 'text-foreground', LEVELS.partial.hint],
              ['Techniques left uncovered', data.uncovered.length, 'text-red-600 dark:text-red-400', 'Every rule for the technique is lost'],
              ['Techniques weakened', data.reduced.length, 'text-amber-600 dark:text-amber-400', 'Some of the technique\'s rules are lost or at risk'],
            ].map(([label, value, color, hint]) => (
              <div key={label as string} className="rounded-lg border border-border bg-card p-4" title={hint as string}>
                <div className={cn('text-2xl font-bold tabular-nums', color as string)}>{(value as number).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Of {data.counts.activeRules.toLocaleString()} active rules · Sysmon events {data.events.join(', ')} · rules without Sysmon links
            aren't affected
          </p>

          {data.uncovered.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400 mb-2">
                <ShieldOff className="w-4 h-4" /> Techniques left without any detection ({data.uncovered.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {data.uncovered.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onShowChain(t.id)}
                    title={`${t.rules} rule${t.rules === 1 ? '' : 's'}, all lost — open the detection chain`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-red-500/30 bg-card text-xs hover:shadow"
                  >
                    <span className="font-mono text-red-600 dark:text-red-400">{t.id}</span>
                    <span className="max-w-[14rem] truncate">{t.name}</span>
                    <span className="text-muted-foreground">−{t.rules}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {data.reduced.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> Techniques weakened ({data.reduced.length})
              </h3>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1.5">
                {data.reduced.map((t) => {
                  const kept = t.rules - t.lost - t.atRisk;
                  return (
                    <button key={t.id} onClick={() => onShowChain(t.id)} className="group grid grid-cols-[4.5rem_1fr_6rem] items-center gap-2 text-left text-xs">
                      <span className="font-mono text-muted-foreground group-hover:text-primary">{t.id}</span>
                      <span className="flex h-2 rounded-full overflow-hidden bg-muted" title={`${kept} kept · ${t.atRisk} at risk · ${t.lost} lost`}>
                        <span className="bg-emerald-500" style={{ width: `${(kept / t.rules) * 100}%` }} />
                        <span className="bg-amber-400" style={{ width: `${(t.atRisk / t.rules) * 100}%` }} />
                        <span className="bg-red-500" style={{ width: `${(t.lost / t.rules) * 100}%` }} />
                      </span>
                      <span className="text-muted-foreground tabular-nums text-right">
                        {kept} of {t.rules} left
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold mr-2">Affected rules</h3>
              {(['all', 'lost', 'atRisk', 'partial'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => {
                    setLevel(l);
                    setShown(LIST_STEP);
                  }}
                  aria-pressed={level === l}
                  className={cn('px-2.5 py-1 rounded-md text-xs border', level === l ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent')}
                >
                  {l === 'all' ? `All ${data.rules.length}` : `${LEVELS[l].label} ${data.counts[l]}`}
                </button>
              ))}
            </div>
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="divide-y divide-border">
                {rules.slice(0, shown).map((r) => (
                  <li key={r.pageId} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                    <span className={cn('px-1.5 py-px rounded border text-[11px] font-medium', LEVELS[r.level].chip)} title={LEVELS[r.level].hint}>
                      {LEVELS[r.level].label}
                    </span>
                    <Link to={`/pages/${r.slug}`} className="text-primary hover:underline min-w-0 truncate max-w-[28rem]">
                      {r.title}
                    </Link>
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-muted-foreground">
                      loses EID {r.lostEvents.join(', ')}
                      {r.level === 'partial' && ` · keeps ${r.sysmon.filter((e) => !r.lostEvents.includes(e)).join(', ')}`}
                    </span>
                    {r.alternatives.length > 0 && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 truncate max-w-[22rem]" title={r.alternatives.join(', ')}>
                        also lists: {r.alternatives.join(', ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {rules.length > shown && (
              <button onClick={() => setShown((n) => n + LIST_STEP)} className="mt-2 text-sm text-primary hover:underline">
                Show more ({(rules.length - shown).toLocaleString()} left)
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
