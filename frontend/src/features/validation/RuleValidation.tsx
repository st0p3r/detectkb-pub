import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { apiErrorMessage, deleteTestRun, getRuleAtomics, getRuleValidation, recordTestRun, type RunResult } from '@/lib/api';
import { ValidationBadge } from '@/components/ui/ValidationBadge';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { RUN_RESULT, RUN_RESULTS, VALIDATION } from '@/lib/validationStatus';
import { cn } from '@/lib/utils';
import { useInvalidateValidation } from './useInvalidateValidation';

const input = 'w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm';
const OTHER = '__other__';

/** "2026-10-01T07:30" for <input type="datetime-local">, in local time */
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** The rule's validation badge, for its header. */
export function RuleValidationBadge({ pageId }: { pageId: number }) {
  const { data } = useQuery({ queryKey: ['rule-validation', pageId], queryFn: () => getRuleValidation(pageId) });
  return data ? <ValidationBadge status={data.status} /> : null;
}

function RecordForm({ pageId, onDone }: { pageId: number; onDone: () => void }) {
  const { data: atomics } = useQuery({ queryKey: ['atomics-rule', pageId], queryFn: () => getRuleAtomics(pageId) });
  const [test, setTest] = useState('');
  const [testName, setTestName] = useState('');
  const [result, setResult] = useState<RunResult>('detected');
  const [executedAt, setExecutedAt] = useState(localNow);
  const [environment, setEnvironment] = useState('');
  const [evidence, setEvidence] = useState('');
  const [notes, setNotes] = useState('');
  const { toast } = useToast();
  const invalidate = useInvalidateValidation();
  const tests = atomics?.tests ?? [];
  const chosen = test || (tests.find((t) => t.match === 'telemetry') ?? tests[0])?.guid || OTHER;

  const save = useMutation({
    mutationFn: () =>
      recordTestRun({
        ...(chosen === OTHER ? { testName } : { atomicGuid: chosen }),
        executedAt: new Date(executedAt).toISOString(),
        environment,
        notes,
        results: [{ pageId, result, evidence }],
      }),
    onSuccess: () => {
      toast('Result recorded', 'success');
      invalidate();
      onDone();
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not record the result'), 'error'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="rounded-md border border-border bg-muted/30 p-3 space-y-2"
    >
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs space-y-1 sm:col-span-2">
          <span className="text-muted-foreground">Test</span>
          <select value={chosen} onChange={(e) => setTest(e.target.value)} className={input}>
            {tests.map((t) => (
              <option key={t.guid} value={t.guid}>
                {t.techniqueId}#{t.testNumber} {t.name}
                {t.match === 'telemetry' ? ' ✓' : ''}
              </option>
            ))}
            <option value={OTHER}>Another test (not Atomic Red Team)…</option>
          </select>
        </label>
        {chosen === OTHER && (
          <label className="text-xs space-y-1 sm:col-span-2">
            <span className="text-muted-foreground">Test name</span>
            <input value={testName} onChange={(e) => setTestName(e.target.value)} required maxLength={500} className={input} placeholder="e.g. Manual mimikatz run" />
          </label>
        )}
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Result</span>
          <select value={result} onChange={(e) => setResult(e.target.value as RunResult)} className={input}>
            {RUN_RESULTS.map((r) => (
              <option key={r} value={r}>
                {RUN_RESULT[r].label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Run at</span>
          <input type="datetime-local" value={executedAt} onChange={(e) => setExecutedAt(e.target.value)} required className={input} />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Environment</span>
          <input value={environment} onChange={(e) => setEnvironment(e.target.value)} maxLength={191} className={input} placeholder="e.g. WIN-VICTIM, Defender excluded" />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Evidence</span>
          <input value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={5000} className={input} placeholder="Alert ID, search job, event count…" />
        </label>
        <label className="text-xs space-y-1 sm:col-span-2">
          <span className="text-muted-foreground">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} rows={2} className={input} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
        <button type="button" onClick={onDone} className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-accent">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Lab validation of a rule: status, history of test runs and a form to record one. */
export function RuleValidation({ pageId }: { pageId: number }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['rule-validation', pageId], queryFn: () => getRuleValidation(pageId) });
  const { hasPermission } = useAuth();
  const canRecord = hasPermission('rules:update');
  const [recording, setRecording] = useState(false);
  const { toast } = useToast();
  const invalidate = useInvalidateValidation();
  const remove = useMutation({
    mutationFn: deleteTestRun,
    onSuccess: () => invalidate(),
    onError: (err) => toast(apiErrorMessage(err, 'Could not delete the run'), 'error'),
  });

  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  if (error || !data) return <p className="text-sm text-destructive">{apiErrorMessage(error, 'Could not load the validation')}</p>;
  const day = (s: string) => new Date(s).toLocaleString();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ValidationBadge status={data.status} />
        <span className="text-xs text-muted-foreground">
          {data.status === 'stale' && data.reason === 'query-changed'
            ? 'The query changed after the last test.'
            : data.status === 'stale'
              ? 'The last test is older than 90 days.'
              : VALIDATION[data.status].hint}
        </span>
        {canRecord && !recording && (
          <button onClick={() => setRecording(true)} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-xs hover:bg-accent">
            <Plus className="w-3.5 h-3.5" /> Record a result
          </button>
        )}
      </div>
      {recording && <RecordForm pageId={pageId} onDone={() => setRecording(false)} />}
      {data.runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Test</th>
                <th className="py-1 pr-3 font-medium">Result</th>
                <th className="py-1 pr-3 font-medium">Environment / evidence</th>
                <th className="py-1 pr-3 font-medium">By</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.runs.map((r) => (
                <tr key={r.id} className={cn(r.queryChangedSince && 'opacity-60')}>
                  <td className="py-1 pr-3 whitespace-nowrap align-top">{day(r.executedAt)}</td>
                  <td className="py-1 pr-3 align-top">
                    {r.atomicGuid ? (
                      <Link to={`/atomic-tests?test=${r.atomicGuid}`} className="text-primary hover:underline">
                        {r.testName}
                      </Link>
                    ) : (
                      r.testName
                    )}
                    {r.queryChangedSince && <span className="block text-amber-600 dark:text-amber-400">query changed since</span>}
                  </td>
                  <td className={cn('py-1 pr-3 whitespace-nowrap align-top font-medium', RUN_RESULT[r.result].className)}>{RUN_RESULT[r.result].label}</td>
                  <td className="py-1 pr-3 align-top text-muted-foreground">
                    {[r.environment, r.evidence].filter(Boolean).join(' · ')}
                    {r.notes && <span className="block whitespace-pre-line">{r.notes}</span>}
                  </td>
                  <td className="py-1 pr-3 align-top text-muted-foreground">{r.recordedBy?.username ?? '—'}</td>
                  <td className="py-1 align-top">
                    {canRecord && (
                      <button
                        onClick={() => window.confirm('Delete this test result?') && remove.mutate(r.id)}
                        aria-label="Delete result"
                        className="p-1 rounded text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
