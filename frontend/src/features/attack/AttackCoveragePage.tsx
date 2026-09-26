import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, ExternalLink, Grid3x3, Loader2, X } from 'lucide-react';
import {
  apiErrorMessage,
  downloadNavigatorLayer,
  getAttackCoverage,
  getTechniqueRules,
  type AttackTechnique,
  type CoveringRule,
} from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

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

export function AttackCoveragePage() {
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [onlyCovered, setOnlyCovered] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['attack-coverage', status],
    queryFn: () => getAttackCoverage(status),
  });

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
      await downloadNavigatorLayer(status);
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
              Enterprise techniques covered by your detection rules
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
          <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm cursor-pointer">
            <input type="checkbox" checked={onlyCovered} onChange={(e) => setOnlyCovered(e.target.checked)} />
            Only covered
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
                      .map((c) => (
                        <button
                          key={c.technique.id}
                          onClick={() => setSelected(c.technique.id === selected ? null : c.technique.id)}
                          title={`${c.technique.id} ${c.technique.name} — ${c.count} rule${c.count === 1 ? '' : 's'}`}
                          className={cn(
                            'w-full text-left px-1.5 py-1 rounded border text-[11px] leading-tight transition-shadow hover:ring-2 hover:ring-primary/40',
                            heatClass(c.count),
                            selected === c.technique.id && 'ring-2 ring-primary'
                          )}
                        >
                          <span className="flex justify-between gap-1">
                            <span className="font-mono opacity-80">{c.technique.id}</span>
                            {c.count > 0 && <span className="font-semibold tabular-nums">{c.count}</span>}
                          </span>
                          <span className="block truncate">{c.technique.name}</span>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedCell && (
            <TechniqueDetail cell={selectedCell} status={status} onClose={() => setSelected(null)} />
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
        </li>
      ))}
    </ul>
  );
}

function TechniqueDetail({ cell, status, onClose }: {
  cell: ParentCell;
  status: string;
  onClose: () => void;
}) {
  const { technique, subs } = cell;
  // The rules load when a technique is opened; the matrix only has counts
  const { data: coverage, isLoading } = useQuery({
    queryKey: ['attack-technique-rules', technique.id, status],
    queryFn: () => getTechniqueRules(technique.id, status),
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
