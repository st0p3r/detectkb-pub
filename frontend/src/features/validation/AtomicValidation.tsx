import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileDown, Loader2 } from 'lucide-react';
import { apiErrorMessage, downloadSavedSearches, getAtomicRuns, recordTestRun, type AtomicTestDetail, type RunResult } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { ATOMIC_MATCH, ATOMIC_MATCH_ORDER } from '@/lib/atomicMatch';
import { RUN_RESULT, RUN_RESULTS } from '@/lib/validationStatus';
import { cn } from '@/lib/utils';
import { useInvalidateValidation } from './useInvalidateValidation';

const SECTION = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2';
const input = 'px-2 py-1.5 rounded-md border border-border bg-background text-sm';

const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** Downloads the given rules (or a selection by status) as savedsearches.conf for the lab Splunk. */
export function ExportSavedSearchesButton({ pageIds, label, className }: { pageIds?: number[]; label: string; className?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('production');
  const [scope, setScope] = useState<'with-tests' | 'all'>('with-tests');
  const run = useMutation({
    mutationFn: () => downloadSavedSearches(pageIds ? { pageIds } : { status, scope }),
    onSuccess: (n) => {
      toast(`${n} rules exported (only rules with an SPL query)`, n ? 'success' : 'info');
      setOpen(false);
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not export the rules'), 'error'),
  });
  const button = (onClick: () => void) => (
    <button
      onClick={onClick}
      disabled={run.isPending}
      title="Splunk saved searches (savedsearches.conf) to load in the lab Splunk"
      className={cn('inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50', className)}
    >
      {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
      {label}
    </button>
  );
  if (pageIds) return button(() => run.mutate());
  return (
    <div className="relative">
      {button(() => setOpen((v) => !v))}
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-border bg-popover p-3 shadow-lg space-y-2 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Rules</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(input, 'w-full')}>
              <option value="production">Production</option>
              <option value="production,testing">Production and testing</option>
              <option value="production,testing,draft">All but deprecated</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Only</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as 'with-tests' | 'all')} className={cn(input, 'w-full')}>
              <option value="with-tests">Rules of techniques with an Atomic test</option>
              <option value="all">Every rule</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">Each rule becomes a saved search that runs every 5 minutes and raises an alert when it finds something.</p>
          <button onClick={() => run.mutate()} disabled={run.isPending} className="w-full px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">
            Download savedsearches.conf
          </button>
        </div>
      )}
    </div>
  );
}

/** Recording a run of this test with a result per rule, and earlier runs. */
export function AtomicValidation({ test }: { test: AtomicTestDetail }) {
  const { hasPermission } = useAuth();
  const canRecord = hasPermission('rules:update');
  const { data: history } = useQuery({ queryKey: ['atomic-runs', test.guid], queryFn: () => getAtomicRuns(test.guid) });
  const [recording, setRecording] = useState(false);
  const [results, setResults] = useState<Record<number, RunResult | ''>>({});
  const [executedAt, setExecutedAt] = useState(localNow);
  const [environment, setEnvironment] = useState('');
  const [notes, setNotes] = useState('');
  const { toast } = useToast();
  const invalidate = useInvalidateValidation();

  const chosen = Object.entries(results).filter(([, r]) => r) as [string, RunResult][];
  const save = useMutation({
    mutationFn: () =>
      recordTestRun({
        atomicGuid: test.guid,
        executedAt: new Date(executedAt).toISOString(),
        environment,
        notes,
        results: chosen.map(([pageId, result]) => ({ pageId: Number(pageId), result })),
      }),
    onSuccess: (r) => {
      toast(`${r.recorded} result${r.recorded === 1 ? '' : 's'} recorded`, 'success');
      setRecording(false);
      setResults({});
      invalidate();
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not record the results'), 'error'),
  });
  const setAll = (match: string, result: RunResult | '') =>
    setResults((prev) => ({ ...prev, ...Object.fromEntries(test.rules.filter((r) => r.match === match).map((r) => [r.pageId, result])) }));
  const seen = test.rules.filter((r) => r.match === 'telemetry');
  const runs = history?.runs ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={cn(SECTION, 'mb-0')}>Lab results</h3>
        <span className="ml-auto flex gap-2">
          {seen.length > 0 && <ExportSavedSearchesButton pageIds={seen.map((r) => r.pageId)} label={`Export its ${seen.length} rules for Splunk`} className="px-2 py-1 text-xs" />}
          {canRecord && !recording && test.rules.length > 0 && (
            <button onClick={() => setRecording(true)} className="px-2 py-1 rounded-md bg-primary text-primary-foreground text-xs">
              Record a run
            </button>
          )}
        </span>
      </div>

      {recording && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="rounded-md border border-border bg-muted/30 p-3 space-y-3"
        >
          <div className="flex flex-wrap gap-2">
            <label className="text-xs space-y-1">
              <span className="block text-muted-foreground">Run at</span>
              <input type="datetime-local" value={executedAt} onChange={(e) => setExecutedAt(e.target.value)} required className={input} />
            </label>
            <label className="text-xs space-y-1 flex-1 min-w-[10rem]">
              <span className="block text-muted-foreground">Environment</span>
              <input value={environment} onChange={(e) => setEnvironment(e.target.value)} maxLength={191} className={cn(input, 'w-full')} placeholder="e.g. WIN-VICTIM" />
            </label>
            <label className="text-xs space-y-1 w-full">
              <span className="block text-muted-foreground">Notes</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} className={cn(input, 'w-full')} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Did each rule fire? Leave a rule on "—" to skip it.</p>
          <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
            {ATOMIC_MATCH_ORDER.map((m) => {
              const rules = test.rules.filter((r) => r.match === m);
              if (!rules.length) return null;
              return (
                <div key={m}>
                  <div className="flex flex-wrap items-center gap-2 mb-1 text-xs">
                    <span className="font-medium">{ATOMIC_MATCH[m].label}</span>
                    <span className="text-muted-foreground">set all:</span>
                    {(['detected', 'not-detected', ''] as const).map((r) => (
                      <button key={r || 'none'} type="button" onClick={() => setAll(m, r)} className="px-1.5 rounded border border-border hover:bg-accent">
                        {r ? RUN_RESULT[r].label : '—'}
                      </button>
                    ))}
                  </div>
                  <ul className="space-y-1">
                    {rules.map((r) => (
                      <li key={r.pageId} className="flex items-center gap-2 text-sm">
                        <select
                          value={results[r.pageId] ?? ''}
                          onChange={(e) => setResults((prev) => ({ ...prev, [r.pageId]: e.target.value as RunResult | '' }))}
                          aria-label={`Result for ${r.title}`}
                          className={cn('px-1.5 py-0.5 rounded border border-border bg-background text-xs w-36', results[r.pageId] && RUN_RESULT[results[r.pageId] as RunResult].className)}
                        >
                          <option value="">—</option>
                          {RUN_RESULTS.map((x) => (
                            <option key={x} value={x}>
                              {RUN_RESULT[x].label}
                            </option>
                          ))}
                        </select>
                        <span className="truncate">{r.title}</span>
                        <StatusBadge status={r.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={!chosen.length || save.isPending} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save {chosen.length || ''} result{chosen.length === 1 ? '' : 's'}
            </button>
            <button type="button" onClick={() => setRecording(false)} className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-accent">
              Cancel
            </button>
          </div>
        </form>
      )}

      {runs.length === 0 ? (
        !recording && <p className="text-sm text-muted-foreground">Not run in the lab yet.</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {runs.slice(0, 30).map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs text-muted-foreground tabular-nums">{new Date(r.executedAt).toLocaleString()}</span>
              <span className={cn('text-xs font-medium', RUN_RESULT[r.result].className)}>{RUN_RESULT[r.result].label}</span>
              <Link to={`/pages/${r.page.slug}`} className="text-primary hover:underline">
                {r.page.title}
              </Link>
              {r.environment && <span className="text-xs text-muted-foreground">{r.environment}</span>}
            </li>
          ))}
          {runs.length > 30 && <li className="text-xs text-muted-foreground">+{runs.length - 30} earlier</li>}
        </ul>
      )}
    </section>
  );
}
