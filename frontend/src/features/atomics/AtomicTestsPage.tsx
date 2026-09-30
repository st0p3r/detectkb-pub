import React, { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, DownloadCloud, ExternalLink, FlaskConical, Loader2, Search, ShieldAlert, Upload } from 'lucide-react';
import { apiErrorMessage, fetchAtomicIndex, getAtomicTest, importAtomicFiles, listAtomicTests, type AtomicImportResult, type AtomicRuleMatch } from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { BasisBadge } from '@/components/ui/BasisBadge';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { useDebounced } from '@/hooks/useDebounced';
import { ATOMIC_MATCH, ATOMIC_MATCH_ORDER, EXECUTOR_LABEL, PLATFORM_LABEL } from '@/lib/atomicMatch';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const SECTION = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2';

export function CopyText({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-xs hover:bg-accent"
      title={label}
      aria-label={label}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function MatchBadge({ match, count }: { match: AtomicRuleMatch; count?: number }) {
  const m = ATOMIC_MATCH[match];
  return (
    <span title={m.hint} className={cn('inline-flex items-center gap-1 px-1.5 rounded border text-[11px] leading-5 whitespace-nowrap', m.className)}>
      {count !== undefined && <b className="tabular-nums">{count}</b>}
      {m.label}
    </span>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="text-xs font-mono bg-muted/60 border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">{children}</pre>
  );
}

function TestDetail({ guid }: { guid: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['atomic', guid], queryFn: () => getAtomicTest(guid) });
  const [raw, setRaw] = useState(false);
  const [showAll, setShowAll] = useState<Partial<Record<AtomicRuleMatch, boolean>>>({});
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;
  if (error || !data) return <p className="text-sm text-destructive">{apiErrorMessage(error, 'Could not load the test')}</p>;
  const command = raw ? data.command : data.resolvedCommand;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl font-semibold">{data.name}</h2>
          <a href={data.fileUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline">
            On GitHub <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link to={`/graph?view=chain&technique=${data.techniqueId}`} className="font-mono text-primary hover:underline">
            {data.techniqueId}
          </Link>
          {data.techniqueName && <span className="text-muted-foreground">{data.techniqueName}</span>}
          <span className="text-muted-foreground">· test #{data.testNumber}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data.platforms.map((p) => (
            <span key={p} className="px-1.5 rounded bg-muted text-xs leading-5">
              {PLATFORM_LABEL[p] ?? p}
            </span>
          ))}
          <span className="px-1.5 rounded bg-muted text-xs leading-5 font-mono">{EXECUTOR_LABEL[data.executor] ?? data.executor}</span>
          {data.elevationRequired && (
            <span className="inline-flex items-center gap-1 px-1.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-xs leading-5">
              <ShieldAlert className="w-3 h-3" /> Needs admin
            </span>
          )}
        </div>
        {data.description && <p className="text-sm text-muted-foreground whitespace-pre-line">{data.description}</p>}
      </div>

      <section className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Run it in the lab</h3>
          <span className="text-xs text-muted-foreground">with the Invoke-AtomicRedTeam PowerShell module · DetectKB never runs tests itself</span>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 text-xs font-mono bg-background border border-border rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">{data.invoke}</code>
          <CopyText text={data.invoke} />
        </div>
        <p className="text-xs text-muted-foreground">
          Add <code className="font-mono">-GetPrereqs</code> first to fetch its tools, and <code className="font-mono">-Cleanup</code> afterwards. Only on an isolated
          test machine.
        </p>
      </section>

      {command && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <h3 className={cn(SECTION, 'mb-0')}>{data.executor === 'manual' ? 'Steps' : 'Command'}</h3>
            {data.inputArguments.length > 0 && (
              <button onClick={() => setRaw((v) => !v)} className="text-xs text-primary hover:underline">
                {raw ? 'Fill in the defaults' : 'Show the #{placeholders}'}
              </button>
            )}
            <span className="ml-auto">
              <CopyText text={command} />
            </span>
          </div>
          <Code>{command}</Code>
        </section>
      )}

      {data.inputArguments.length > 0 && (
        <section>
          <h3 className={SECTION}>Inputs</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                {data.inputArguments.map((i) => (
                  <tr key={i.name}>
                    <td className="py-1 pr-3 font-mono whitespace-nowrap align-top">{i.name}</td>
                    <td className="py-1 pr-3 text-muted-foreground align-top">{i.description}</td>
                    <td className="py-1 font-mono break-all align-top">{i.default}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h3 className={SECTION}>Telemetry it should produce ({data.expectedTelemetry.length})</h3>
        {data.expectedTelemetry.length ? (
          <>
            <ul className="divide-y divide-border/60">
              {data.expectedTelemetry.map((e) => (
                <li key={e.key} className="flex flex-wrap items-baseline gap-x-3 py-1 text-sm">
                  <span title={e.key}>{e.label}</span>
                  <span className="text-xs text-muted-foreground">{e.why}</span>
                  <BasisBadge basis="inferred" className="ml-auto" />
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Inferred from the platform, the executor and what the command does, assuming Sysmon, process-creation auditing and PowerShell
              script block logging are on.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.executor === 'manual' ? 'A manual test: nothing to infer.' : 'None inferred for this platform (only Windows and Linux endpoints are).'}
          </p>
        )}
      </section>

      <section>
        <h3 className={SECTION}>Rules for {data.techniqueId} ({data.rules.length})</h3>
        {data.rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active rule is mapped to this technique: running the test shows a gap.</p>
        ) : (
          <div className="space-y-3">
            {ATOMIC_MATCH_ORDER.filter((m) => data.ruleCounts[m]).map((m) => {
              const rules = data.rules.filter((r) => r.match === m);
              const shown = showAll[m] ? rules : rules.slice(0, 12);
              return (
                <div key={m}>
                  <div className="flex items-center gap-2 mb-1">
                    <MatchBadge match={m} count={rules.length} />
                    <span className="text-xs text-muted-foreground">{ATOMIC_MATCH[m].hint}</span>
                  </div>
                  <ul className="space-y-0.5">
                    {shown.map((r) => (
                      <li key={r.pageId} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <Link to={`/pages/${r.slug}`} className="text-primary hover:underline">
                          {r.title}
                        </Link>
                        <StatusBadge status={r.status} />
                        {r.relation === 'parent' && <span className="text-[11px] text-muted-foreground">tagged with the parent technique</span>}
                        {r.sharedTelemetry.length > 0 && <span className="text-[11px] text-muted-foreground font-mono">{r.sharedTelemetry.join(', ')}</span>}
                      </li>
                    ))}
                  </ul>
                  {rules.length > shown.length && (
                    <button onClick={() => setShowAll((s) => ({ ...s, [m]: true }))} className="mt-1 text-xs text-primary hover:underline">
                      +{rules.length - shown.length} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {data.dependencies.length > 0 && (
        <section>
          <h3 className={SECTION}>Prerequisites ({data.dependencyExecutor ?? data.executor})</h3>
          <ul className="space-y-2">
            {data.dependencies.map((d, i) => (
              <li key={i} className="text-sm">
                <p>{d.description}</p>
                {d.getPrereqCommand && (
                  <details className="mt-1">
                    <summary className="text-xs text-primary cursor-pointer">How it is fetched</summary>
                    <Code>{d.getPrereqCommand}</Code>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.resolvedCleanup && (
        <section>
          <h3 className={SECTION}>Cleanup</h3>
          <Code>{raw ? data.cleanupCommand ?? '' : data.resolvedCleanup}</Code>
        </section>
      )}

      <p className="text-xs text-muted-foreground font-mono break-all">GUID {data.guid}</p>
    </div>
  );
}

const importMessage = (r: AtomicImportResult) =>
  `${r.tests} tests for ${r.techniques} techniques · ${r.added} new, ${r.updated} updated${r.removed ? `, ${r.removed} removed` : ''}${
    r.skipped?.length ? ` · ${r.skipped.length} files were not atomics` : ''
  }`;

/** Atomic Red Team tests, their expected telemetry, and the rules each should trigger. */
export function AtomicTestsPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('test');
  const technique = params.get('technique') ?? '';
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const [platform, setPlatform] = useState('');
  const [executor, setExecutor] = useState('');
  const [match, setMatch] = useState('');
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['atomics', q, technique, platform, executor, match],
    queryFn: () => listAtomicTests({ q, technique, platform, executor, match }),
    placeholderData: keepPreviousData,
  });
  const tests = useMemo(() => data?.tests ?? [], [data]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['atomics'] });
    qc.invalidateQueries({ queryKey: ['atomic'] });
  };
  const download = useMutation({
    mutationFn: fetchAtomicIndex,
    onSuccess: (r) => {
      toast(importMessage(r), 'success');
      refresh();
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not download the tests'), 'error'),
  });
  const upload = useMutation({
    mutationFn: async (files: FileList) => importAtomicFiles(await Promise.all(Array.from(files).map(async (f) => ({ name: f.name, content: await f.text() })))),
    onSuccess: (r) => {
      toast(importMessage(r), r.tests ? 'success' : 'info');
      refresh();
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not import the files'), 'error'),
  });

  const select = 'px-2 py-1 rounded-md border border-border bg-background text-xs';
  return (
    <div className="max-w-full">
      <Breadcrumbs items={[{ label: 'Atomic Red Team' }]} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <FlaskConical className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Atomic Red Team</h1>
          <p className="text-sm text-muted-foreground">
            Small attack tests per ATT&CK technique, the telemetry each should produce, and the rules it should trigger
          </p>
        </div>
        {hasPermission('settings:manage') && (
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => download.mutate()}
              disabled={download.isPending}
              title="atomics/Indexes/index.yaml from github.com/redcanaryco/atomic-red-team"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
            >
              {download.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
              {data?.total ? 'Update from GitHub' : 'Download from GitHub'}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
              title="Technique files (atomics/T*/T*.yaml) or atomics/Indexes/index.yaml — for servers without internet access"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
            >
              {upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload files
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".yml,.yaml"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) upload.mutate(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>

      {error ? (
        <p className="text-destructive text-sm">{apiErrorMessage(error)}</p>
      ) : data && data.total === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No tests yet.{' '}
          {hasPermission('settings:manage')
            ? 'Download them from GitHub, or upload the atomics folder (or atomics/Indexes/index.yaml) on a server without internet access.'
            : 'An administrator can load them from GitHub or from files.'}
        </div>
      ) : (
        <>
          {data && (
            <p className="text-xs text-muted-foreground mb-3">
              {data.total.toLocaleString()} tests for {data.techniques} techniques
              {data.updatedAt && ` · updated ${relativeTime(data.updatedAt)}`}
            </p>
          )}
          <div className="grid lg:grid-cols-[26rem_1fr] gap-4 items-start">
            <div className="rounded-lg border border-border bg-card">
              <div className="p-3 space-y-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    data-page-search
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search tests, technique IDs or GUIDs…"
                    aria-label="Search tests"
                    className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform" className={select}>
                    <option value="">All platforms</option>
                    {['windows', 'linux', 'macos', 'containers', 'iaas:aws', 'iaas:azure', 'iaas:gcp', 'azure-ad', 'office-365'].map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_LABEL[p]}
                      </option>
                    ))}
                  </select>
                  <select value={executor} onChange={(e) => setExecutor(e.target.value)} aria-label="Executor" className={select}>
                    <option value="">Any executor</option>
                    {Object.entries(EXECUTOR_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select value={match} onChange={(e) => setMatch(e.target.value)} aria-label="Rules" className={select}>
                    <option value="">Any rules</option>
                    <option value="telemetry">A rule sees its telemetry</option>
                    <option value="no-telemetry-match">No rule sees its telemetry</option>
                    <option value="none">No rule for the technique</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{tests.length.toLocaleString()} tests</span>
                  {technique && (
                    <button onClick={() => setParam('technique', null)} className="ml-auto px-1.5 rounded bg-primary/10 text-primary font-mono">
                      {technique} ✕
                    </button>
                  )}
                </div>
              </div>
              {isLoading ? (
                <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </p>
              ) : tests.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No test matches.</p>
              ) : (
                <ul className="max-h-[calc(100vh-18rem)] overflow-y-auto divide-y divide-border">
                  {tests.map((t) => {
                    const total = t.rules.telemetry + t.rules.edr + t.rules['other-telemetry'] + t.rules.unknown;
                    return (
                      <li key={t.guid}>
                        <button
                          onClick={() => setParam('test', t.guid)}
                          aria-current={selected === t.guid}
                          className={cn('w-full text-left px-3 py-2 hover:bg-accent/50', selected === t.guid && 'bg-primary/10')}
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-xs text-muted-foreground shrink-0">{t.techniqueId}</span>
                            <span className="font-medium truncate">{t.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                            <span className="truncate">
                              {t.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(', ')} · {EXECUTOR_LABEL[t.executor] ?? t.executor}
                            </span>
                            <span className="ml-auto shrink-0">
                              {t.rules.telemetry ? (
                                <MatchBadge match="telemetry" count={t.rules.telemetry} />
                              ) : total ? (
                                <span title="Rules for the technique, none reading this test's telemetry">{total} rules, none see it</span>
                              ) : (
                                <span className="text-red-500">no rule</span>
                              )}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card p-5 min-w-0">
              {selected ? <TestDetail guid={selected} /> : <p className="text-sm text-muted-foreground">Pick a test to see its command, expected telemetry and rules.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
