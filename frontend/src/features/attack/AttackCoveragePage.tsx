import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, ExternalLink, Grid3x3, Loader2, ShieldCheck, Skull, X } from 'lucide-react';
import {
  apiErrorMessage,
  downloadNavigatorLayer,
  getAttackCoverage,
  getD3fend,
  getSoftware,
  getTechniqueContext,
  getTechniqueRules,
  getThreatGroup,
  listThreatGroups,
  type ActorCoverage,
  type AttackTechnique,
  type CoveringRule,
} from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { safeHref } from '@/lib/safeUrl';
import { TechniqueAtomics } from '@/features/atomics/AtomicSections';
import { ValidationBadge } from '@/components/ui/ValidationBadge';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Active rules (not deprecated)' },
  { value: 'production', label: 'Production only' },
  { value: 'production,testing', label: 'Production + testing' },
  { value: 'all', label: 'All rules' },
];

// Heat scale by number of covering rules (technique + its sub-techniques)
const HEAT = [
  { min: 5, cell: 'bg-blue-700 text-white border-blue-800', label: '5+' },
  { min: 3, cell: 'bg-blue-500 text-white border-blue-600', label: '3–4' },
  { min: 2, cell: 'bg-sky-300 text-sky-950 border-sky-400 dark:bg-sky-600 dark:text-white dark:border-sky-500', label: '2' },
  { min: 1, cell: 'bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-900/70 dark:text-sky-100 dark:border-sky-800', label: '1' },
];
const NO_COVERAGE = 'bg-muted/40 text-muted-foreground border-border';

function heatClass(count: number) {
  return HEAT.find((h) => count >= h.min)?.cell ?? NO_COVERAGE;
}

const attackUrl = (id: string) => `https://attack.mitre.org/techniques/${id.replace('.', '/')}/`;

interface ParentCell {
  technique: AttackTechnique;
  subs: AttackTechnique[];
  /** Rules on the technique itself or any sub-technique (each rule once). */
  count: number;
}

/** The techniques (as parent IDs) a group (G…) or software (S…) uses. */
function useActor(actor: string | null, status: string) {
  const isGroup = actor?.startsWith('G');
  const { data } = useQuery({
    queryKey: ['attack-actor', actor, status],
    queryFn: async (): Promise<{ id: string; name: string; coverage: ActorCoverage }> =>
      isGroup ? getThreatGroup(actor!, status) : getSoftware(actor!, status),
    enabled: !!actor && /^[GS]\d{4}$/.test(actor),
  });
  return useMemo(() => {
    if (!data) return null;
    const parents = new Set(data.coverage.techniques.map((t) => t.id.split('.')[0]));
    return { id: data.id, name: data.name, coverage: data.coverage, parents };
  }, [data]);
}

export function AttackCoveragePage() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const actorId = params.get('actor');
  const [status, setStatus] = useState('');
  // Proven coverage: only rules whose latest lab test detected the attack
  const [validatedOnly, setValidatedOnly] = useState(false);
  const [onlyCovered, setOnlyCovered] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['attack-coverage', status, validatedOnly],
    queryFn: () => getAttackCoverage(status, validatedOnly),
  });
  const actor = useActor(actorId, status);
  const { data: groups = [] } = useQuery({ queryKey: ['threat-groups', '', ''], queryFn: () => listThreatGroups() });
  const setActor = (id: string | null) => setParams(id ? { actor: id } : {});

  // tactic shortname → parent technique cells
  const columns = useMemo(() => {
    if (!data) return [];
    const subsByParent = new Map<string, AttackTechnique[]>();
    for (const t of data.techniques) {
      if (!t.id.includes('.')) continue;
      const parent = t.id.split('.')[0];
      subsByParent.set(parent, [...(subsByParent.get(parent) ?? []), t]);
    }
    const cellFor = (t: AttackTechnique): ParentCell => ({
      technique: t,
      subs: subsByParent.get(t.id) ?? [],
      count: data.parentCounts[t.id] ?? 0,
    });
    const parents = data.techniques.filter((t) => !t.id.includes('.')).map(cellFor);
    return data.tactics.map((tactic) => {
      const cells = parents
        .filter((c) => c.technique.tactics.includes(tactic.shortname))
        .sort((a, b) => b.count - a.count || a.technique.name.localeCompare(b.technique.name));
      return { tactic, cells, covered: cells.filter((c) => c.count > 0).length };
    });
  }, [data]);

  const selectedCell = useMemo(() => {
    for (const col of columns) {
      const cell = col.cells.find((c) => c.technique.id === selected);
      if (cell) return cell;
    }
    return null;
  }, [columns, selected]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadNavigatorLayer(status, validatedOnly);
    } catch (err) {
      toast(apiErrorMessage(err, 'Could not export the layer'), 'error');
    } finally {
      setDownloading(false);
    }
  }

  const pct = data?.summary.totalTechniques
    ? Math.round((data.summary.coveredTechniques / data.summary.totalTechniques) * 100)
    : 0;

  return (
    <div className="max-w-full">
      <Breadcrumbs items={[{ label: 'ATT&CK Coverage' }]} />

      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <Grid3x3 className="w-6 h-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">MITRE ATT&CK Coverage</h1>
            <p className="text-sm text-muted-foreground">
              {validatedOnly ? 'Enterprise techniques covered by rules proven in the lab' : 'Enterprise techniques covered by your detection rules'}
              {data?.attackVersion ? ` · ATT&CK v${data.attackVersion}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Rule status filter"
            className="px-3 py-2 rounded-md border border-border bg-background text-sm"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            value={actorId?.startsWith('G') ? actorId : ''}
            onChange={(e) => setActor(e.target.value || null)}
            aria-label="Highlight a threat group"
            className="px-3 py-2 rounded-md border border-border bg-background text-sm max-w-[14rem]"
          >
            <option value="">Highlight a threat group…</option>
            {[...groups]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.id})
                </option>
              ))}
          </select>
          <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm cursor-pointer">
            <input type="checkbox" checked={onlyCovered} onChange={(e) => setOnlyCovered(e.target.checked)} />
            Only covered
          </label>
          <label
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm cursor-pointer"
            title="Count only rules whose latest lab test (Atomic Red Team) detected the attack"
          >
            <input type="checkbox" checked={validatedOnly} onChange={(e) => setValidatedOnly(e.target.checked)} />
            Proven in lab only
          </label>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Navigator layer
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-20 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading coverage…
        </div>
      )}
      {error && <p className="text-destructive">{apiErrorMessage(error)}</p>}

      {data && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Techniques covered', value: `${data.summary.coveredTechniques} / ${data.summary.totalTechniques}` },
              { label: 'Coverage', value: `${pct}%` },
              { label: 'Rules analyzed', value: data.summary.rulesAnalyzed },
              { label: 'Tactics with coverage', value: `${columns.filter((c) => c.covered).length} / ${columns.length}` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="text-xl font-semibold tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>

          {data.unknownTechniques.length > 0 && (
            <div className="flex items-start gap-2 mb-5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 flex-shrink-0" />
              <div>
                Unknown or deprecated technique IDs (not shown in the matrix):{' '}
                {data.unknownTechniques.map((u, i) => (
                  <span key={u.id}>
                    {i > 0 && ', '}
                    <span className="font-mono">{u.id}</span> in{' '}
                    {u.rules.map((r, j) => (
                      <span key={r.pageId}>
                        {j > 0 && ', '}
                        <Link to={`/pages/${r.slug}`} className="underline">{r.title}</Link>
                      </span>
                    ))}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.retiredTechniques.length > 0 && (
            <details className="mb-5 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none">
                <AlertTriangle className="inline w-4 h-4 mr-1.5 -mt-0.5 text-sky-500" />
                {data.retiredTechniques.reduce((n, t) => n + t.rules.length, 0)} rule mappings use ATT&CK IDs that MITRE has
                retired; they are counted under the replacement technique:{' '}
                {data.retiredTechniques.map((t, i) => (
                  <span key={t.id} className="font-mono text-xs">
                    {i > 0 && ', '}
                    {t.id}→{t.replacedBy} ×{t.rules.length}
                  </span>
                ))}
              </summary>
              <ul className="mt-2 space-y-1.5 pl-5 list-disc">
                {data.retiredTechniques.map((t) => (
                  <li key={t.id}>
                    <span className="font-mono">{t.id} → {t.replacedBy}</span>:{' '}
                    {t.rules.map((r, j) => (
                      <span key={r.pageId}>
                        {j > 0 && ', '}
                        <Link to={`/pages/${r.slug}`} className="underline">{r.title}</Link>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {actor && (
            <div className="flex flex-wrap items-center gap-3 mb-4 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm">
              <Skull className="w-4 h-4 text-rose-500" />
              <span>
                Techniques used by{' '}
                <Link to={`/threat-groups?${actor.id.startsWith('G') ? 'group' : 'tab=software&software'}=${actor.id}`} className="font-medium text-primary hover:underline">
                  {actor.name}
                </Link>{' '}
                <span className="font-mono text-xs text-muted-foreground">{actor.id}</span>: {actor.coverage.covered} of {actor.coverage.total} covered (
                {actor.coverage.pct}%){actor.coverage.parentOnly > 0 && `, ${actor.coverage.parentOnly} only through the parent technique`}. Other
                techniques are dimmed; red outlines are the gaps.
              </span>
              <button onClick={() => setActor(null)} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-muted-foreground">
            <span>Rules per technique (incl. sub-techniques):</span>
            <span className="flex items-center gap-1"><span className={cn('w-4 h-4 rounded border', NO_COVERAGE)} /> 0</span>
            {[...HEAT].reverse().map((h) => (
              <span key={h.label} className="flex items-center gap-1">
                <span className={cn('w-4 h-4 rounded border', h.cell)} /> {h.label}
              </span>
            ))}
          </div>

          {/* Matrix */}
          <div className="overflow-x-auto pb-3 rounded-lg border border-border bg-card">
            <div className="flex gap-1.5 p-2 min-w-max">
              {columns.map(({ tactic, cells, covered }) => (
                <div key={tactic.id} className="w-40 flex-shrink-0">
                  <div className="sticky top-0 mb-1.5 px-2 py-2 rounded-md bg-muted text-center">
                    <a
                      href={`https://attack.mitre.org/tactics/${tactic.id}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-xs font-semibold leading-tight hover:underline"
                    >
                      {tactic.name}
                    </a>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {covered} / {cells.length}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {cells
                      .filter((c) => !onlyCovered || c.count > 0)
                      .map((c) => {
                        const used = actor?.parents.has(c.technique.id);
                        return (
                        <button
                          key={c.technique.id}
                          onClick={() => setSelected(c.technique.id === selected ? null : c.technique.id)}
                          title={`${c.technique.id} ${c.technique.name} — ${c.count} rule${c.count === 1 ? '' : 's'}${used ? ` · used by ${actor!.name}` : ''}`}
                          className={cn(
                            'w-full text-left px-1.5 py-1 rounded border text-[11px] leading-tight transition-shadow hover:ring-2 hover:ring-primary/40',
                            heatClass(c.count),
                            actor && !used && 'opacity-20',
                            used && !c.count && 'ring-2 ring-red-500',
                            selected === c.technique.id && 'ring-2 ring-primary'
                          )}
                        >
                          <span className="flex justify-between gap-1">
                            <span className="font-mono opacity-80">{c.technique.id}</span>
                            {c.count > 0 && <span className="font-semibold tabular-nums">{c.count}</span>}
                          </span>
                          <span className="block truncate">{c.technique.name}</span>
                        </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedCell && (
            <TechniqueDetail cell={selectedCell} status={status} validatedOnly={validatedOnly} onClose={() => setSelected(null)} />
          )}
        </>
      )}
    </div>
  );
}

function RuleList({ rules }: { rules: CoveringRule[] }) {
  return (
    <ul className="space-y-1">
      {rules.map((r) => (
        <li key={r.pageId} className="flex flex-wrap items-center gap-2 text-sm">
          <Link to={`/pages/${r.slug}`} className="text-primary hover:underline">{r.title}</Link>
          <StatusBadge status={r.status} />
          <SeverityBadge severity={r.severity} />
          {r.validation !== 'never' && <ValidationBadge status={r.validation} />}
        </li>
      ))}
    </ul>
  );
}

function TechniqueDetail({ cell, status, validatedOnly, onClose }: {
  cell: ParentCell;
  status: string;
  validatedOnly: boolean;
  onClose: () => void;
}) {
  const { technique, subs } = cell;
  // The rules load when a technique is opened; the matrix only has counts
  const { data: coverage, isLoading } = useQuery({
    queryKey: ['attack-technique-rules', technique.id, status, validatedOnly],
    queryFn: () => getTechniqueRules(technique.id, status, validatedOnly),
  });
  const own = coverage?.[technique.id] ?? [];
  return (
    <div className="mt-5 rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold">
            <span className="font-mono text-muted-foreground mr-2">{technique.id}</span>
            {technique.name}
          </h2>
          <div className="flex flex-wrap gap-3">
            <a href={attackUrl(technique.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              View on attack.mitre.org <ExternalLink className="w-3 h-3" />
            </a>
            <Link to={`/graph?view=chain&technique=${technique.id}`} className="text-xs text-primary hover:underline">
              Detection chain
            </Link>
            <Link to={`/graph?view=explore&focus=technique:${technique.id}`} className="text-xs text-primary hover:underline">
              Explore in graph
            </Link>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close details" className="p-1 rounded hover:bg-accent">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Rules mapped to {technique.id} {coverage && `(${own.length})`}
          </h3>
          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading rules…
            </p>
          ) : own.length ? (
            <RuleList rules={own} />
          ) : (
            <p className="text-sm text-muted-foreground">None.</p>
          )}
        </div>

        <TechniqueContextPanel id={technique.id} />

        <div className="pt-2 border-t border-border">
          <TechniqueAtomics id={technique.id} className={SECTION} />
        </div>

        {subs.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Sub-techniques ({subs.filter((s) => coverage?.[s.id]?.length).length} / {subs.length} covered)
            </h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {subs.map((s) => {
                const rules = coverage?.[s.id] ?? [];
                return (
                  <div key={s.id} className={cn('rounded-md border px-3 py-2', rules.length ? 'border-primary/30' : 'border-border')}>
                    <a href={attackUrl(s.id)} target="_blank" rel="noreferrer" className="text-sm hover:underline">
                      <span className="font-mono text-xs text-muted-foreground mr-1.5">{s.id}</span>
                      {s.name}
                    </a>
                    {rules.length > 0 && (
                      <div className="mt-1">
                        <RuleList rules={rules} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const SECTION = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2';
const PREVIEW = 24;

/** Mitigations, D3FEND countermeasures and the groups / software using a technique. */
function TechniqueContextPanel({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ['technique-context', id], queryFn: () => getTechniqueContext(id), staleTime: 60 * 60 * 1000 });
  const { data: d3, isLoading: d3Loading } = useQuery({ queryKey: ['d3fend', id], queryFn: () => getD3fend(id), staleTime: 60 * 60 * 1000 });
  const [allGroups, setAllGroups] = useState(false);
  const [allSoftware, setAllSoftware] = useState(false);
  if (!data) return null;
  const d3ByTactic = new Map<string, NonNullable<typeof d3>['countermeasures']>();
  for (const c of d3?.countermeasures ?? []) d3ByTactic.set(c.tactic ?? 'Other', [...(d3ByTactic.get(c.tactic ?? 'Other') ?? []), c]);
  const groups = allGroups ? data.groups : data.groups.slice(0, PREVIEW);
  const software = allSoftware ? data.software : data.software.slice(0, PREVIEW);
  const via = (v: string[]) => (v.length === 1 && v[0] === id ? '' : ` · via ${v.join(', ')}`);
  return (
    <div className="grid md:grid-cols-2 gap-5 pt-2 border-t border-border">
      <div>
        <h3 className={SECTION}>
          <ShieldCheck className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
          ATT&CK mitigations ({data.mitigations.length})
        </h3>
        {data.mitigations.length === 0 ? (
          <p className="text-sm text-muted-foreground">None listed.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.mitigations.map((m) => (
              <li key={m.id} className="text-sm">
                <a href={safeHref(m.url)} target="_blank" rel="noreferrer" className="font-medium hover:underline" title={m.description}>
                  {m.name}
                </a>{' '}
                <span className="font-mono text-xs text-muted-foreground">
                  {m.id}
                  {via(m.via)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className={SECTION}>D3FEND countermeasures</h3>
        {d3Loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Asking D3FEND…
          </p>
        ) : !d3?.available ? (
          <p className="text-sm text-muted-foreground">
            {d3?.error ?? 'Not available'} ·{' '}
            <a href={d3?.pageUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              open on d3fend.mitre.org
            </a>
          </p>
        ) : d3.countermeasures.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            D3FEND maps no countermeasure to {id}.{' '}
            <a href={d3.pageUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              d3fend.mitre.org
            </a>
          </p>
        ) : (
          <div className="space-y-2">
            {Array.from(d3ByTactic).map(([tactic, list]) => (
              <div key={tactic} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="w-16 font-semibold text-muted-foreground">{tactic}</span>
                {list.map((c) => (
                  <a
                    key={c.name}
                    href={safeHref(c.url ?? d3.pageUrl)}
                    target="_blank"
                    rel="noreferrer"
                    title={c.artifact ? `Acts on: ${c.artifact}` : undefined}
                    className="px-2 py-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
                  >
                    {c.name}
                  </a>
                ))}
              </div>
            ))}
            <a href={d3.pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              d3fend.mitre.org <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>

      <div>
        <h3 className={SECTION}>
          <Skull className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
          Threat groups using it ({data.groups.length})
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => (
            <Link key={g.id} to={`/threat-groups?group=${g.id}`} title={`${g.id}${via(g.via)}`} className="px-2 py-0.5 rounded-full border border-border text-xs hover:bg-accent">
              {g.name}
            </Link>
          ))}
          {data.groups.length > groups.length && (
            <button onClick={() => setAllGroups(true)} className="text-xs text-primary hover:underline">
              +{data.groups.length - groups.length} more
            </button>
          )}
          {!data.groups.length && <span className="text-sm text-muted-foreground">None known.</span>}
        </div>
      </div>

      <div>
        <h3 className={SECTION}>Malware & tools using it ({data.software.length})</h3>
        <div className="flex flex-wrap gap-1.5">
          {software.map((sw) => (
            <Link
              key={sw.id}
              to={`/threat-groups?tab=software&software=${sw.id}`}
              title={`${sw.id} · ${sw.type}${via(sw.via)}`}
              className="px-2 py-0.5 rounded-full border border-border text-xs hover:bg-accent"
            >
              {sw.name}
            </Link>
          ))}
          {data.software.length > software.length && (
            <button onClick={() => setAllSoftware(true)} className="text-xs text-primary hover:underline">
              +{data.software.length - software.length} more
            </button>
          )}
          {!data.software.length && <span className="text-sm text-muted-foreground">None known.</span>}
        </div>
      </div>
    </div>
  );
}
