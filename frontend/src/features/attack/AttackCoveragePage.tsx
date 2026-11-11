import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, CircleOff, Download, ExternalLink, Grid3x3, Loader2, Radar, ScrollText, ShieldCheck, Skull, X } from 'lucide-react';
import {
  apiErrorMessage,
  downloadNavigatorLayer,
  getAttackCoverage,
  getD3fend,
  getSoftware,
  getTechniqueContext,
  getTechniqueRules,
  getThreatGroup,
  getWatchlist,
  listThreatGroups,
  type ActorCoverage,
  type AttackTechnique,
  type AttackAnalytic,
  type CoverageConfidence,
  type CoverageFilters,
  type CoveringRule,
} from '@/lib/api';
import { FeedBadge } from '@/features/collection/CollectionBadge';
import { CoverageTrend } from './CoverageTrend';
import { useClickOutside } from '@/hooks/useClickOutside';
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

// Confidence scale: the best rule of the technique (and its sub-techniques)
const CONFIDENCE: Record<CoverageConfidence, { label: string; hint: string; cell: string; bar: string }> = {
  validated: {
    label: 'Proven in lab',
    hint: 'A production or testing rule whose latest lab test detected the attack',
    cell: 'bg-emerald-700 text-white border-emerald-800',
    bar: 'bg-emerald-700',
  },
  production: {
    label: 'Production',
    hint: 'A production rule, not proven in the lab',
    cell: 'bg-emerald-300 text-emerald-950 border-emerald-400 dark:bg-emerald-600 dark:text-white dark:border-emerald-500',
    bar: 'bg-emerald-400',
  },
  testing: {
    label: 'Testing only',
    hint: 'Only rules still in testing',
    cell: 'bg-amber-200 text-amber-950 border-amber-300 dark:bg-amber-600 dark:text-white dark:border-amber-500',
    bar: 'bg-amber-300',
  },
  draft: {
    label: 'Draft only',
    hint: 'Only draft rules: nothing runs for this technique yet',
    cell: 'bg-orange-50 text-orange-900 border-orange-300 border-dashed dark:bg-orange-950/50 dark:text-orange-200 dark:border-orange-700',
    bar: 'bg-orange-300',
  },
};
const CONFIDENCE_ORDER: CoverageConfidence[] = ['validated', 'production', 'testing', 'draft'];

function heatClass(count: number) {
  return HEAT.find((h) => count >= h.min)?.cell ?? NO_COVERAGE;
}

const attackUrl = (id: string) => `https://attack.mitre.org/techniques/${id.replace('.', '/')}/`;

interface ParentCell {
  technique: AttackTechnique;
  subs: AttackTechnique[];
  /** Rules on the technique itself or any sub-technique (each rule once). */
  count: number;
  confidence: CoverageConfidence | null;
  /** How many of those rules can't fire: their logs aren't collected */
  blind: number;
}

const PLATFORMS_KEY = 'coveragePlatforms';

/** The ATT&CK platforms the matrix is limited to (remembered per browser). */
function usePlatforms() {
  const [platforms, set] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PLATFORMS_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      return [];
    }
  });
  const setPlatforms = (next: string[]) => {
    set(next);
    try {
      localStorage.setItem(PLATFORMS_KEY, JSON.stringify(next));
    } catch {
      // private mode: the choice lasts for this visit
    }
  };
  return [platforms, setPlatforms] as const;
}

/** "All platforms" / "Windows, Linux" with a checklist. */
function PlatformFilter({ all, value, onChange }: { all: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const toggle = (p: string) => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  const label = value.length === 0 ? 'All platforms' : value.length <= 2 ? value.join(', ') : `${value.length} platforms`;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Limit the matrix to the platforms you run: techniques for other platforms are not gaps"
        className={cn('flex items-center gap-1.5 px-3 py-2 rounded-md border bg-background text-sm', value.length ? 'border-primary/50 text-primary' : 'border-border')}
      >
        {label} <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border bg-popover p-1.5 shadow-lg">
          {all.map((p) => (
            <label key={p} className="flex items-center gap-2 px-2 py-1 rounded text-sm cursor-pointer hover:bg-accent">
              <input type="checkbox" checked={value.includes(p)} onChange={() => toggle(p)} /> {p}
            </label>
          ))}
          {value.length > 0 && (
            <button onClick={() => onChange([])} className="w-full mt-1 px-2 py-1 rounded text-left text-xs text-primary hover:bg-accent">
              Show all platforms
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The techniques (as parent IDs) a group (G…), software (S…) or the watchlist (every watched group) uses. */
function useActor(actor: string | null, status: string) {
  const isGroup = actor?.startsWith('G');
  const { data } = useQuery({
    queryKey: ['attack-actor', actor, status],
    queryFn: async (): Promise<{ id: string; name: string; coverage: ActorCoverage }> => {
      if (actor === 'watchlist') {
        // Coverage by production / testing rules, whatever the status filter
        const w = await getWatchlist();
        const s = w.summary;
        return {
          id: 'watchlist',
          name: `the watchlist (${w.groups.length} group${w.groups.length === 1 ? '' : 's'})`,
          coverage: {
            techniques: w.techniques.map((t) => ({ id: t.id, name: t.name, tactics: t.tactics, rules: t.deployedRules, state: t.state })),
            total: s.techniques,
            covered: s.covered,
            parentOnly: s.parentOnly,
            pct: s.techniques ? Math.round((s.covered / s.techniques) * 100) : 0,
          },
        };
      }
      return isGroup ? getThreatGroup(actor!, status) : getSoftware(actor!, status);
    },
    enabled: !!actor && (actor === 'watchlist' || /^[GS]\d{4}$/.test(actor)),
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
  // Rules that run (or are about to): drafts would make coverage look better than it is
  const [status, setStatus] = useState('production,testing');
  const [colorBy, setColorBy] = useState<'confidence' | 'count'>('confidence');
  const cellClass = (c: ParentCell) =>
    colorBy === 'confidence' ? (c.confidence ? CONFIDENCE[c.confidence].cell : NO_COVERAGE) : heatClass(c.count);
  // Proven coverage: only rules whose latest lab test detected the attack
  const [validatedOnly, setValidatedOnly] = useState(false);
  const [platforms, setPlatforms] = usePlatforms();
  // Rules whose logs aren't collected can't fire: left out unless asked for
  const [withLogs, setWithLogs] = useState(true);
  const filters: CoverageFilters = { status, validatedOnly, withLogs, platforms };
  const [onlyCovered, setOnlyCovered] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['attack-coverage', status, validatedOnly, withLogs, platforms.join(',')],
    queryFn: () => getAttackCoverage(filters),
    placeholderData: (prev) => prev,
  });
  const collectionActive = !!data?.summary.collectionActive;
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
      confidence: data.parentConfidence[t.id] ?? null,
      blind: data.parentBlind[t.id] ?? 0,
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
      await downloadNavigatorLayer(filters);
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
            value={actorId?.startsWith('G') || actorId === 'watchlist' ? actorId : ''}
            onChange={(e) => setActor(e.target.value || null)}
            aria-label="Highlight a threat group"
            className="px-3 py-2 rounded-md border border-border bg-background text-sm max-w-[14rem]"
          >
            <option value="">Highlight a threat group…</option>
            <option value="watchlist">★ Watchlist (all watched groups)</option>
            {[...groups]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.id})
                </option>
              ))}
          </select>
          <select
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as 'confidence' | 'count')}
            aria-label="Color cells by"
            className="px-3 py-2 rounded-md border border-border bg-background text-sm"
          >
            <option value="confidence">Color: confidence</option>
            <option value="count">Color: rule count</option>
          </select>
          {data && <PlatformFilter all={data.platforms} value={platforms} onChange={setPlatforms} />}
          <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm cursor-pointer">
            <input type="checkbox" checked={onlyCovered} onChange={(e) => setOnlyCovered(e.target.checked)} />
            Only covered
          </label>
          {collectionActive && (
            <label
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm cursor-pointer"
              title="Leave out rules whose logs are marked as not collected on the Log Sources page: they cannot fire"
            >
              <input type="checkbox" checked={withLogs} onChange={(e) => setWithLogs(e.target.checked)} />
              Only rules with logs
            </label>
          )}
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

          {data.summary.coveredTechniques > 0 && (
            <div className="mb-5 rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm mb-2">
                <span className="font-medium">Coverage confidence</span>
                <span className="text-xs text-muted-foreground">covered techniques by their best rule</span>
              </div>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
                {CONFIDENCE_ORDER.map((l) =>
                  data.summary.confidence[l] ? (
                    <span
                      key={l}
                      className={CONFIDENCE[l].bar}
                      style={{ width: `${(data.summary.confidence[l] / data.summary.totalTechniques) * 100}%` }}
                      title={`${data.summary.confidence[l]} ${CONFIDENCE[l].label.toLowerCase()}`}
                    />
                  ) : null
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                {CONFIDENCE_ORDER.map((l) => (
                  <span key={l} title={CONFIDENCE[l].hint}>
                    <span className={cn('inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle', CONFIDENCE[l].bar)} />
                    <b className="text-foreground tabular-nums">{data.summary.confidence[l]}</b> {CONFIDENCE[l].label.toLowerCase()}
                  </span>
                ))}
                <span>
                  <b className="text-foreground tabular-nums">{data.summary.totalTechniques - data.summary.coveredTechniques}</b> not covered
                </span>
              </div>
            </div>
          )}

          {!collectionActive ? (
            <div className="flex flex-wrap items-center gap-2 mb-5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <ScrollText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span>
                These numbers assume every rule receives its logs. Say which log sources you collect and rules without logs stop counting as
                coverage.
              </span>
              <Link to="/log-sources" className="ml-auto text-primary hover:underline whitespace-nowrap">
                Set what is collected →
              </Link>
            </div>
          ) : data.summary.blindRules > 0 ? (
            <div className="flex flex-wrap items-center gap-2 mb-5 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
              <CircleOff className="w-4 h-4 text-red-500 flex-shrink-0" />
              {withLogs ? (
                <span>
                  <b>{data.summary.blindRules}</b> rule{data.summary.blindRules === 1 ? ' is' : 's are'} left out: the logs{' '}
                  {data.summary.blindRules === 1 ? 'it reads' : 'they read'} are not collected, so {data.summary.blindRules === 1 ? 'it' : 'they'} cannot fire.
                </span>
              ) : (
                <span>
                  <b>{data.summary.blindRules}</b> counted rule{data.summary.blindRules === 1 ? '' : 's'} cannot fire (logs not collected)
                  {data.summary.blindTechniques > 0 && (
                    <>
                      ; <b>{data.summary.blindTechniques}</b> technique{data.summary.blindTechniques === 1 ? ' is' : 's are'} covered on paper only (hatched
                      cells)
                    </>
                  )}
                  .
                </span>
              )}
              <Link to="/rules?logs=blind" className="ml-auto text-primary hover:underline whitespace-nowrap">
                Show these rules →
              </Link>
            </div>
          ) : null}

          <CoverageTrend />

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
                <Link
                  to={actor.id === 'watchlist' ? '/threat-groups?tab=watchlist' : `/threat-groups?${actor.id.startsWith('G') ? 'group' : 'tab=software&software'}=${actor.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {actor.name}
                </Link>
                {actor.id !== 'watchlist' && (
                  <>
                    {' '}
                    <span className="font-mono text-xs text-muted-foreground">{actor.id}</span>
                  </>
                )}: {actor.coverage.covered} of {actor.coverage.total} covered (
                {actor.coverage.pct}%){actor.coverage.parentOnly > 0 && `, ${actor.coverage.parentOnly} only through the parent technique`}. Other
                techniques are dimmed; red outlines are the gaps.
              </span>
              <button onClick={() => setActor(null)} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
          )}

          {/* Legend */}
          {colorBy === 'confidence' ? (
            <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-muted-foreground">
              <span>Best rule of the technique (incl. sub-techniques):</span>
              {CONFIDENCE_ORDER.map((l) => (
                <span key={l} className="flex items-center gap-1" title={CONFIDENCE[l].hint}>
                  <span className={cn('w-4 h-4 rounded border', CONFIDENCE[l].cell)} /> {CONFIDENCE[l].label}
                </span>
              ))}
              <span className="flex items-center gap-1"><span className={cn('w-4 h-4 rounded border', NO_COVERAGE)} /> No rule</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-muted-foreground">
              <span>Rules per technique (incl. sub-techniques):</span>
              <span className="flex items-center gap-1"><span className={cn('w-4 h-4 rounded border', NO_COVERAGE)} /> 0</span>
              {[...HEAT].reverse().map((h) => (
                <span key={h.label} className="flex items-center gap-1">
                  <span className={cn('w-4 h-4 rounded border', h.cell)} /> {h.label}
                </span>
              ))}
            </div>
          )}

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
                        // Every rule of the cell lacks its logs: covered on paper only
                        const paperOnly = c.count > 0 && c.blind === c.count;
                        return (
                        <button
                          key={c.technique.id}
                          onClick={() => setSelected(c.technique.id === selected ? null : c.technique.id)}
                          title={`${c.technique.id} ${c.technique.name} — ${c.count} rule${c.count === 1 ? '' : 's'}${c.confidence ? ` · ${CONFIDENCE[c.confidence].label.toLowerCase()}` : ''}${c.blind ? ` · ${paperOnly ? 'none' : `${c.count - c.blind} of ${c.count}`} with logs collected` : ''}${used ? ` · used by ${actor!.name}` : ''}`}
                          className={cn(
                            'w-full text-left px-1.5 py-1 rounded border text-[11px] leading-tight transition-shadow hover:ring-2 hover:ring-primary/40',
                            cellClass(c),
                            paperOnly && 'cell-no-logs',
                            actor && !used && 'opacity-20',
                            used && !c.count && 'ring-2 ring-red-500',
                            selected === c.technique.id && 'ring-2 ring-primary'
                          )}
                        >
                          <span className="flex justify-between gap-1">
                            <span className="font-mono opacity-80">{c.technique.id}</span>
                            {c.count > 0 && (
                              <span className="flex items-center gap-0.5 font-semibold tabular-nums">
                                {paperOnly && <CircleOff className="w-3 h-3" aria-label="No logs collected" />}
                                {c.count}
                              </span>
                            )}
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
            <TechniqueDetail cell={selectedCell} filters={filters} showFeed={collectionActive} onClose={() => setSelected(null)} />
          )}
        </>
      )}
    </div>
  );
}

function RuleList({ rules, showFeed }: { rules: CoveringRule[]; showFeed?: boolean }) {
  return (
    <ul className="space-y-1">
      {rules.map((r) => (
        <li key={r.pageId} className="flex flex-wrap items-center gap-2 text-sm">
          <Link to={`/pages/${r.slug}`} className="text-primary hover:underline">{r.title}</Link>
          <StatusBadge status={r.status} />
          <SeverityBadge severity={r.severity} />
          {r.validation !== 'never' && <ValidationBadge status={r.validation} />}
          {showFeed && r.feed === 'blind' && <FeedBadge feed={r.feed} />}
        </li>
      ))}
    </ul>
  );
}

function TechniqueDetail({ cell, filters, showFeed, onClose }: {
  cell: ParentCell;
  filters: CoverageFilters;
  showFeed: boolean;
  onClose: () => void;
}) {
  const { technique, subs } = cell;
  // The rules load when a technique is opened; the matrix only has counts
  const { data: coverage, isLoading } = useQuery({
    queryKey: ['attack-technique-rules', technique.id, filters.status, filters.validatedOnly, filters.withLogs],
    queryFn: () => getTechniqueRules(technique.id, filters),
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
        <TechniqueAbout id={technique.id} />

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Rules mapped to {technique.id} {coverage && `(${own.length})`}
          </h3>
          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading rules…
            </p>
          ) : own.length ? (
            <RuleList rules={own} showFeed={showFeed} />
          ) : (
            <p className="text-sm text-muted-foreground">None.</p>
          )}
        </div>

        <TechniqueContextPanel id={technique.id} platforms={filters.platforms ?? []} />

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
                        <RuleList rules={rules} showFeed={showFeed} />
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

/** What the technique is and where it applies. */
function TechniqueAbout({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ['technique-context', id], queryFn: () => getTechniqueContext(id), staleTime: 60 * 60 * 1000 });
  if (!data || (!data.description && !data.platforms.length)) return null;
  return (
    <div>
      {data.description && <p className="text-sm leading-relaxed max-w-4xl">{data.description}</p>}
      {data.platforms.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="text-xs text-muted-foreground">Platforms:</span>
          {data.platforms.map((p) => (
            <span key={p} className="px-1.5 py-0.5 rounded bg-muted text-xs">
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const ANALYTIC_PREVIEW = 3;

/** One of MITRE's analytics: what to look for on a platform, in which logs, and what to tune. */
export function AnalyticCard({ analytic }: { analytic: AttackAnalytic }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5 mb-1">
        <span className="font-mono text-xs text-muted-foreground">{analytic.id}</span>
        {analytic.platforms.map((p) => (
          <span key={p} className="px-1.5 py-0.5 rounded bg-muted text-[11px]">
            {p}
          </span>
        ))}
      </div>
      <p className="text-sm leading-relaxed">{analytic.description}</p>
      {analytic.logSources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {analytic.logSources.map((l, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded border border-border text-[11px]" title={l.component ? `Data component: ${l.component}` : undefined}>
              <span className="font-mono">{l.name}</span>
              {l.channel && <span className="text-muted-foreground"> · {l.channel}</span>}
            </span>
          ))}
        </div>
      )}
      {analytic.tunables.length > 0 && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">What to tune ({analytic.tunables.length})</summary>
          <ul className="mt-1 space-y-0.5 pl-4 list-disc">
            {analytic.tunables.map((t) => (
              <li key={t.field}>
                <span className="font-mono text-foreground">{t.field}</span>
                {t.description && ` — ${t.description}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** MITRE's detection strategy for the technique: analytics per platform. */
function DetectionGuidance({ id, platforms }: { id: string; platforms: string[] }) {
  const { data } = useQuery({ queryKey: ['technique-context', id], queryFn: () => getTechniqueContext(id), staleTime: 60 * 60 * 1000 });
  const [all, setAll] = useState(false);
  if (!data || (!data.detection.length && !data.detectionText)) return null;
  const analytics = data.detection.flatMap((d) => d.analytics);
  // The platforms the matrix is limited to first; the others stay reachable
  const matching = platforms.length ? analytics.filter((a) => !a.platforms.length || a.platforms.some((p) => platforms.includes(p))) : analytics;
  const list = platforms.length && matching.length ? matching : analytics;
  const shown = all ? list : list.slice(0, ANALYTIC_PREVIEW);
  return (
    <div className="pt-2 border-t border-border">
      <h3 className={SECTION}>
        <Radar className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
        How MITRE suggests detecting it
        {list.length > 0 && ` (${list.length} analytic${list.length === 1 ? '' : 's'}${list !== analytics ? ` for ${platforms.join(', ')}` : ''})`}
      </h3>
      {data.detection.map((d) => (
        <p key={d.id} className="text-sm mb-2">
          <a href={`https://attack.mitre.org/detectionstrategies/${d.id}/`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
            {d.name}
          </a>{' '}
          <span className="font-mono text-xs text-muted-foreground">{d.id}</span>
        </p>
      ))}
      {data.detectionText && <p className="text-sm leading-relaxed max-w-4xl">{data.detectionText}</p>}
      <div className="grid lg:grid-cols-2 gap-2">
        {shown.map((a) => (
          <AnalyticCard key={a.id} analytic={a} />
        ))}
      </div>
      {list.length > shown.length && (
        <button onClick={() => setAll(true)} className="mt-2 text-xs text-primary hover:underline">
          Show all {list.length} analytics
        </button>
      )}
    </div>
  );
}

/** MITRE's detection guidance, mitigations, D3FEND countermeasures and the groups / software using a technique. */
function TechniqueContextPanel({ id, platforms }: { id: string; platforms: string[] }) {
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
    <>
    <DetectionGuidance id={id} platforms={platforms} />
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
    </>
  );
}
