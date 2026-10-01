import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, ShieldOff, Unplug, X } from 'lucide-react';
import { apiErrorMessage, bulkUpdateRules, getImpact, listLogEvents, listLogSources, listPages, listSysmonEvents, type ImpactedRule } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

export interface ImpactSelection {
  /** Whole log sources: sysmon, windows-security, … */
  sources: string[];
  /** Single events (telemetry keys): sysmon:10, windows-security:4688, … */
  events: string[];
  dataSource: number | null;
}

interface ImpactViewProps extends ImpactSelection {
  onChange: (next: ImpactSelection) => void;
  onShowChain: (technique: string) => void;
}

const LEVELS: Record<ImpactedRule['level'], { label: string; hint: string; chip: string }> = {
  lost: { label: 'Lost', hint: 'All the telemetry it reads is gone and it names no other data source', chip: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30' },
  atRisk: {
    label: 'At risk',
    hint: 'All the telemetry DetectKB knows it reads is gone; other data sources it names may still feed it',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
  partial: { label: 'Partial', hint: 'Some of the telemetry it reads is gone, the rest still feeds it', chip: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30' },
};

const LIST_STEP = 50;
const LOST_STATUSES = [
  ['deprecated', 'Deprecated'],
  ['draft', 'Draft'],
] as const;
const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

/** Events of one log source to pick from (Sysmon from its own reference). */
function useSourceEvents(source: string) {
  const sysmon = useQuery({ queryKey: ['sysmon-events'], queryFn: () => listSysmonEvents(), enabled: source === 'sysmon' });
  const logs = useQuery({ queryKey: ['log-events', source], queryFn: () => listLogEvents(source), enabled: !!source && source !== 'sysmon' });
  if (source === 'sysmon') {
    return (sysmon.data ?? []).filter((e) => e.ruleCount > 0).map((e) => ({ key: `sysmon:${e.eventId}`, code: String(e.eventId), name: e.name, rules: e.ruleCount }));
  }
  return (logs.data ?? []).filter((e) => e.rules > 0).map((e) => ({ key: e.key, code: e.code === '*' ? 'any' : e.code, name: e.name, rules: e.rules }));
}

/** "What if we stop collecting …?" — rules and techniques that depend on some telemetry. */
export function ImpactView({ sources, events, dataSource, onChange, onShowChain }: ImpactViewProps) {
  const { data: logSources = [] } = useQuery({ queryKey: ['log-sources'], queryFn: listLogSources });
  const { data: dsPages = [] } = useQuery({ queryKey: ['pages', 'DATA_SOURCE'], queryFn: () => listPages({ type: 'DATA_SOURCE' }) });
  const [eventSource, setEventSource] = useState('sysmon');
  const sourceEvents = useSourceEvents(eventSource);
  const hasSelection = sources.length > 0 || events.length > 0 || !!dataSource;
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['graph-impact', sources, events, dataSource],
    queryFn: () => getImpact({ sources, events, dataSource: dataSource ?? undefined }),
    enabled: hasSelection,
  });
  const [level, setLevel] = useState<ImpactedRule['level'] | 'all'>('all');
  const [shown, setShown] = useState(LIST_STEP);
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [lostStatus, setLostStatus] = useState<(typeof LOST_STATUSES)[number][0] | null>(null);
  const [busy, setBusy] = useState(false);

  // Exactly the rules this selection leaves without any telemetry (e.g. an EDR the organisation doesn't have)
  const lostRules = (data?.rules ?? []).filter((r) => r.level === 'lost');
  async function setLost(status: string) {
    setLostStatus(null);
    setBusy(true);
    try {
      const { changed } = await bulkUpdateRules({ pageIds: lostRules.map((r) => r.pageId) }, 'status', status);
      toast(`${changed} rule${changed === 1 ? '' : 's'} set to ${status}`, 'success');
      queryClient.invalidateQueries({ queryKey: ['graph-impact'] });
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['data-health'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      toast(apiErrorMessage(err, 'Could not change the rules'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const set = (next: Partial<ImpactSelection>) => onChange({ sources, events, dataSource, ...next });
  const lostKeys = new Set(data?.events ?? []);
  const rules = (data?.rules ?? []).filter((r) => level === 'all' || r.level === level);
  const label = (key: string) => data?.labels[key] ?? key;
  const sourceName = (key: string) => logSources.find((s) => s.key === key)?.label ?? key;
  const chip = (on: boolean, implied = false) =>
    cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors',
      on ? 'bg-red-500 text-white border-red-500' : implied ? 'border-red-400 text-red-600 dark:text-red-400' : 'border-border hover:bg-accent'
    );

  return (
    <div data-graph-export className="flex-1 min-h-0 overflow-auto space-y-4 pb-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Unplug className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">If we stop collecting…</span>
          <select
            value={dataSource ?? ''}
            onChange={(e) => set({ dataSource: e.target.value ? Number(e.target.value) : null })}
            aria-label="Data source"
            className="px-2.5 py-1.5 rounded-md border border-border bg-background text-sm"
          >
            <option value="">a data source page (all its events)…</option>
            {dsPages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          {hasSelection && (
            <button onClick={() => onChange({ sources: [], events: [], dataSource: null })} className="text-xs text-primary hover:underline ml-auto">
              Clear
            </button>
          )}
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1.5">…whole log sources:</div>
          <div className="flex flex-wrap gap-1.5">
            {logSources
              .filter((s) => s.rules > 0)
              .map((s) => (
                <button
                  key={s.key}
                  onClick={() => set({ sources: toggle(sources, s.key) })}
                  aria-pressed={sources.includes(s.key)}
                  title={`${s.label} — ${s.rules} rules`}
                  className={chip(sources.includes(s.key))}
                >
                  <span className="max-w-[12rem] truncate">{s.label}</span>
                  <span className="opacity-70 tabular-nums">{s.rules}</span>
                </button>
              ))}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1.5 text-xs text-muted-foreground">
            …or single events of
            <select
              value={eventSource}
              onChange={(e) => setEventSource(e.target.value)}
              aria-label="Log source for single events"
              className="px-2 py-1 rounded-md border border-border bg-background text-xs text-foreground"
            >
              {logSources
                .filter((s) => s.rules > 0)
                .map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sourceEvents.map((e) => (
              <button
                key={e.key}
                onClick={() => set({ events: toggle(events, e.key) })}
                aria-pressed={events.includes(e.key)}
                title={`${e.name} — ${e.rules} rules`}
                className={chip(events.includes(e.key), lostKeys.has(e.key))}
              >
                <span className="font-semibold tabular-nums">{e.code}</span>
                <span className="max-w-[10rem] truncate">{e.name}</span>
                <span className="opacity-70 tabular-nums">{e.rules}</span>
              </button>
            ))}
          </div>
        </div>

        {(sources.length > 0 || events.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border text-xs">
            <span className="text-muted-foreground">Selected:</span>
            {sources.map((s) => (
              <button key={s} onClick={() => set({ sources: toggle(sources, s) })} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                {sourceName(s)} (all) <X className="w-3 h-3" />
              </button>
            ))}
            {events.map((e) => (
              <button key={e} onClick={() => set({ events: toggle(events, e) })} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                {label(e)} <X className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}
      </div>

      {!hasSelection ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Pick log sources, single events or a data source page above to see which rules and ATT&CK techniques depend on them.
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
              ['Techniques weakened', data.reduced.length, 'text-amber-600 dark:text-amber-400', "Some of the technique's rules are lost or at risk"],
            ].map(([title, value, color, hint]) => (
              <div key={title as string} className="rounded-lg border border-border bg-card p-4" title={hint as string}>
                <div className={cn('text-2xl font-bold tabular-nums', color as string)}>{(value as number).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{title}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Of {data.counts.activeRules.toLocaleString()} active rules · {data.events.length} event{data.events.length === 1 ? '' : 's'} lost · a rule is
            lost only when all the telemetry it reads is gone; rules without telemetry links aren't affected
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
              {lostRules.length > 0 && hasPermission('rules:update') && (
                <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <select
                    value=""
                    disabled={busy}
                    onChange={(e) => setLostStatus(e.target.value as (typeof LOST_STATUSES)[number][0])}
                    title="Change the status of the lost rules only — at-risk and degraded rules still have telemetry and are left as they are"
                    className="px-2 py-1 rounded-md border border-border bg-background text-xs text-foreground"
                  >
                    <option value="">
                      Set the {lostRules.length} lost rule{lostRules.length === 1 ? '' : 's'} to…
                    </option>
                    {LOST_STATUSES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="divide-y divide-border">
                {rules.slice(0, shown).map((r) => {
                  const kept = r.telemetry.filter((k) => !r.lostEvents.includes(k));
                  return (
                    <li key={r.pageId} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                      <span className={cn('px-1.5 py-px rounded border text-[11px] font-medium', LEVELS[r.level].chip)} title={LEVELS[r.level].hint}>
                        {LEVELS[r.level].label}
                      </span>
                      <Link to={`/pages/${r.slug}`} className="text-primary hover:underline min-w-0 truncate max-w-[28rem]">
                        {r.title}
                      </Link>
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-muted-foreground truncate max-w-[26rem]" title={r.lostEvents.map(label).join(', ')}>
                        loses {r.lostEvents.map(label).join(', ')}
                      </span>
                      {r.groups.length > 0 && (
                        <span className="text-xs text-rose-600 dark:text-rose-400" title="The rule's data source says these are needed together">
                          needs together: {r.groups.map((g) => g.map(label).join(' + ')).join(' · ')}
                        </span>
                      )}
                      {kept.length > 0 && r.level === 'partial' && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 truncate max-w-[22rem]" title={kept.map(label).join(', ')}>
                          keeps {kept.map(label).join(', ')}
                        </span>
                      )}
                      {r.alternatives.length > 0 && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 truncate max-w-[22rem]" title={r.alternatives.join(', ')}>
                          also names: {r.alternatives.join(', ')}
                        </span>
                      )}
                    </li>
                  );
                })}
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
      <ConfirmDialog
        open={!!lostStatus}
        title={`Set ${lostRules.length} lost rule${lostRules.length === 1 ? '' : 's'} to ${lostStatus}?`}
        message={`Only the rules marked "Lost" change: all the telemetry they read is in this selection and they name no other data source. At-risk and degraded rules are left as they are. The change is recorded in the audit log and can be undone from the Rules list.`}
        confirmLabel={`Set to ${lostStatus}`}
        onConfirm={() => lostStatus && setLost(lostStatus)}
        onCancel={() => setLostStatus(null)}
      />
    </div>
  );
}
