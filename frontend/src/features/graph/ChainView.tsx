import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { getAttackCoverage, getDetectionChain, type ChainRule, type DetectionChain } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ENTITY_GROUPS } from './graphStyle';

// Column geometry (px)
const COLS = { tactic: 0, technique: 150, rule: 400, sysmon: 740, ds: 950 };
const WIDTH = { tactic: 120, technique: 210, rule: 300, sysmon: 170, ds: 180 };
const TOTAL_WIDTH = COLS.ds + WIDTH.ds;
const ROW = { rule: 54, technique: 50, sysmon: 44, ds: 44, tactic: 44 };
const HEAD = 36;
const RULE_PAGE = 40;

const STATUS_ORDER: Record<string, number> = { production: 0, testing: 1, draft: 2, deprecated: 3 };
const STATUS_DOT: Record<string, string> = {
  production: 'bg-emerald-500',
  testing: 'bg-amber-500',
  draft: 'bg-slate-400',
  deprecated: 'bg-red-500',
};

type ItemId = string; // tactic:TA0006 | technique:T1003 | rule:12 | sysmon:10 | ds:4

/**
 * Places items of one column at the average y of the items they connect to
 * (barycentre), then pushes them apart so none overlap.
 */
function placeColumn(ids: ItemId[], target: (id: ItemId) => number | null, rowHeight: number, fallbackStart: number) {
  const desired = ids.map((id, i) => ({ id, y: target(id) ?? fallbackStart + i * rowHeight }));
  desired.sort((a, b) => a.y - b.y);
  const placed = new Map<ItemId, number>();
  let floor = HEAD;
  for (const d of desired) {
    const y = Math.max(d.y, floor);
    placed.set(d.id, y);
    floor = y + rowHeight;
  }
  return placed;
}

function layout(chain: DetectionChain, rules: ChainRule[]) {
  const techOrder = new Map(chain.techniques.map((t, i) => [t.id, i]));
  const y = new Map<ItemId, number>();
  const edges: [ItemId, ItemId][] = [];

  rules.forEach((r, i) => y.set(`rule:${r.pageId}`, HEAD + i * ROW.rule));
  const center = (id: ItemId, h: number) => (y.get(id) ?? 0) + h / 2;
  const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);

  // Techniques ↔ rules
  const techIds = chain.techniques.map((t) => `technique:${t.id}`);
  const techRules = new Map(techIds.map((id) => [id, rules.filter((r) => r.techniques.includes(id.split(':')[1]))]));
  // Rules are grouped by technique, so each technique sits next to the first rule of its group
  const techPos = placeColumn(
    [...techIds].sort((a, b) => (techOrder.get(a.split(':')[1]) ?? 0) - (techOrder.get(b.split(':')[1]) ?? 0)),
    (id) => {
      const ys = techRules.get(id)!.map((r) => y.get(`rule:${r.pageId}`)!);
      return ys.length ? Math.min(...ys) : null;
    },
    ROW.technique,
    HEAD + rules.length * ROW.rule
  );
  techPos.forEach((v, k) => y.set(k, v));
  for (const [tid, rs] of techRules) for (const r of rs) edges.push([tid, `rule:${r.pageId}`]);

  // Tactics ↔ techniques
  const tacticIds = chain.tactics.map((t) => `tactic:${t.id}`);
  const tacticPos = placeColumn(
    tacticIds,
    () => HEAD,
    ROW.tactic,
    HEAD
  );
  tacticPos.forEach((v, k) => y.set(k, v));
  for (const ta of tacticIds) for (const te of techIds) edges.push([ta, te]);

  // Rules ↔ Sysmon events
  const sysIds = chain.sysmon.map((s) => `sysmon:${s.eventId}`);
  const sysPos = placeColumn(
    sysIds,
    (id) => {
      const eid = Number(id.split(':')[1]);
      const c = avg(rules.filter((r) => r.sysmon.includes(eid)).map((r) => center(`rule:${r.pageId}`, ROW.rule)));
      return c === null ? null : c - ROW.sysmon / 2;
    },
    ROW.sysmon,
    HEAD
  );
  sysPos.forEach((v, k) => y.set(k, v));
  for (const r of rules) for (const e of r.sysmon) edges.push([`rule:${r.pageId}`, `sysmon:${e}`]);

  // Sysmon events ↔ data sources
  const dsIds = chain.dataSources.map((d) => `ds:${d.pageId}`);
  const dsPos = placeColumn(
    dsIds,
    (id) => {
      const d = chain.dataSources.find((x) => `ds:${x.pageId}` === id)!;
      const c = avg(d.sysmon.filter((e) => y.has(`sysmon:${e}`)).map((e) => center(`sysmon:${e}`, ROW.sysmon)));
      return c === null ? null : c - ROW.ds / 2;
    },
    ROW.ds,
    HEAD
  );
  dsPos.forEach((v, k) => y.set(k, v));
  for (const d of chain.dataSources) for (const e of d.sysmon) if (y.has(`sysmon:${e}`)) edges.push([`sysmon:${e}`, `ds:${d.pageId}`]);

  const height = Math.max(...Array.from(y.values()).map((v) => v + 90), 300);
  return { y, edges, height };
}

const kindOf = (id: ItemId) => id.split(':')[0] as keyof typeof COLS;
const heightOf = (id: ItemId) => ROW[kindOf(id)] - 8;

export function ChainView({ technique, onTechniqueChange }: { technique: string; onTechniqueChange: (t: string) => void }) {
  const [status, setStatus] = useState('');
  const [ruleFilter, setRuleFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [pinned, setPinned] = useState<ItemId | null>(null);
  const [hovered, setHovered] = useState<ItemId | null>(null);
  const [picker, setPicker] = useState('');

  const { data: coverage } = useQuery({ queryKey: ['attack-coverage', 'all'], queryFn: () => getAttackCoverage('all') });
  const { data: chain, isLoading, error } = useQuery({
    queryKey: ['detection-chain', technique, status],
    queryFn: () => getDetectionChain(technique, status),
  });

  const pickerResults = useMemo(() => {
    const q = picker.trim().toLowerCase();
    if (!q || !coverage) return [];
    return coverage.techniques
      .filter((t) => !t.id.includes('.') && (t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)))
      .slice(0, 10)
      .map((t) => ({
        ...t,
        rules: coverage.parentCounts[t.id] ?? 0,
      }));
  }, [picker, coverage]);

  const rules = useMemo(() => {
    if (!chain) return [];
    const q = ruleFilter.trim().toLowerCase();
    const order = new Map(chain.techniques.map((t, i) => [t.id, i]));
    return chain.rules
      .filter((r) => !q || r.title.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Math.min(...a.techniques.map((t) => order.get(t) ?? 99)) - Math.min(...b.techniques.map((t) => order.get(t) ?? 99)) ||
          (a.sysmon[0] ?? 999) - (b.sysmon[0] ?? 999) ||
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
          a.title.localeCompare(b.title)
      );
  }, [chain, ruleFilter]);
  const shownRules = showAll ? rules : rules.slice(0, RULE_PAGE);

  const geo = useMemo(() => (chain ? layout(chain, shownRules) : null), [chain, shownRules]);

  // Everything connected (transitively, left and right) to the focused item
  const related = useMemo(() => {
    const focus = hovered ?? pinned;
    if (!focus || !geo) return null;
    const adj = new Map<ItemId, ItemId[]>();
    for (const [a, b] of geo.edges) {
      adj.set(a, [...(adj.get(a) ?? []), b]);
      adj.set(b, [...(adj.get(b) ?? []), a]);
    }
    const order = ['tactic', 'technique', 'rule', 'sysmon', 'ds'];
    const set = new Set([focus]);
    // Walk outwards in both directions, only moving away from the focus column
    const walk = (id: ItemId, dir: 1 | -1) => {
      for (const n of adj.get(id) ?? []) {
        if ((order.indexOf(kindOf(n)) - order.indexOf(kindOf(id))) * dir <= 0 || set.has(n)) continue;
        set.add(n);
        walk(n, dir);
      }
    };
    walk(focus, 1);
    walk(focus, -1);
    return set;
  }, [hovered, pinned, geo]);

  const itemProps = (id: ItemId) => ({
    onMouseEnter: () => setHovered(id),
    onMouseLeave: () => setHovered(null),
    onClick: () => setPinned((p) => (p === id ? null : id)),
    style: { top: geo!.y.get(id), left: COLS[kindOf(id)], width: WIDTH[kindOf(id)], height: heightOf(id) },
    className: cn(
      'absolute rounded-md border px-2.5 py-1 text-xs cursor-pointer transition-opacity bg-card overflow-hidden',
      pinned === id ? 'ring-2 ring-primary' : '',
      related && !related.has(id) ? 'opacity-25' : 'opacity-100'
    ),
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={picker}
            onChange={(e) => setPicker(e.target.value)}
            placeholder="Technique (e.g. T1059, Phishing)"
            aria-label="Choose technique"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
          />
          {pickerResults.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card shadow-lg py-1 text-sm">
              {pickerResults.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => {
                      setPicker('');
                      setPinned(null);
                      setShowAll(false);
                      onTechniqueChange(t.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"
                  >
                    <span className="font-mono text-xs text-muted-foreground">{t.id}</span>
                    <span className="truncate flex-1">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.rules}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Rule status" className="px-3 py-2 rounded-md border border-border bg-background text-sm">
          <option value="">Active rules</option>
          <option value="production">Production only</option>
          <option value="production,testing">Production + testing</option>
        </select>
        <input
          value={ruleFilter}
          onChange={(e) => setRuleFilter(e.target.value)}
          placeholder="Filter rules…"
          aria-label="Filter rules"
          className="px-3 py-2 rounded-md border border-border bg-background text-sm w-48"
        />
        {chain && (
          <span className="text-sm text-muted-foreground">
            <span className="font-mono">{chain.technique.id}</span> {chain.technique.name} · {rules.length} rule{rules.length === 1 ? '' : 's'} ·{' '}
            {chain.sysmon.length} Sysmon event{chain.sysmon.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="relative flex-1 min-h-[420px] rounded-lg border border-border bg-card overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading chain…
          </div>
        )}
        {error ? <p className="p-6 text-destructive text-sm">{String((error as Error).message)}</p> : null}
        {chain && geo && (
          <div className="relative m-4" style={{ width: TOTAL_WIDTH, height: geo.height }} onClick={(e) => e.target === e.currentTarget && setPinned(null)}>
            {(['tactic', 'technique', 'rule', 'sysmon', 'ds'] as const).map((k) => (
              <div key={k} className="absolute top-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ left: COLS[k], width: WIDTH[k] }}>
                {{ tactic: 'Tactic', technique: 'Technique', rule: 'Detection rules', sysmon: 'Sysmon events', ds: 'Data sources' }[k]}
              </div>
            ))}

            <svg className="absolute inset-0 pointer-events-none" width={TOTAL_WIDTH} height={geo.height}>
              {geo.edges.map(([a, b]) => {
                const x1 = COLS[kindOf(a)] + WIDTH[kindOf(a)];
                const y1 = geo.y.get(a)! + heightOf(a) / 2;
                const x2 = COLS[kindOf(b)];
                const y2 = geo.y.get(b)! + heightOf(b) / 2;
                const mid = (x1 + x2) / 2;
                const on = related ? related.has(a) && related.has(b) : false;
                return (
                  <path
                    key={`${a}-${b}`}
                    d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={on ? 'rgb(99,102,241)' : 'rgb(148,163,184)'}
                    strokeOpacity={related ? (on ? 0.9 : 0.06) : 0.4}
                    strokeWidth={on ? 1.8 : 1}
                  />
                );
              })}
            </svg>

            {chain.tactics.map((t) => (
              <div key={t.id} {...itemProps(`tactic:${t.id}`)}>
                <div className="font-mono text-muted-foreground">{t.id}</div>
                <div className="font-medium truncate">{t.name}</div>
              </div>
            ))}
            {chain.techniques.map((t) => (
              <div key={t.id} {...itemProps(`technique:${t.id}`)} title={t.name}>
                <div className="flex justify-between gap-1">
                  <span className="font-mono" style={{ color: ENTITY_GROUPS.technique.color }}>{t.id}</span>
                  <span className={cn('tabular-nums', t.ruleCount ? 'font-semibold' : 'text-muted-foreground')}>{t.ruleCount}</span>
                </div>
                <div className={cn('truncate', !t.ruleCount && 'text-muted-foreground')}>{t.name}</div>
              </div>
            ))}
            {shownRules.map((r) => (
              <div key={r.pageId} {...itemProps(`rule:${r.pageId}`)} title={`${r.title}\n${r.dataSource ?? ''}`}>
                <div className="flex items-center gap-1.5">
                  <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATUS_DOT[r.status] ?? 'bg-slate-400')} title={r.status} />
                  <span className="truncate font-medium flex-1">{r.title}</span>
                  <Link to={`/pages/${r.slug}`} onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-primary" aria-label={`Open ${r.title}`}>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
                <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground truncate">
                  <span>{r.severity}</span>
                  {r.sourceFormat && <span>· {r.sourceFormat}</span>}
                  {!r.sysmon.length && r.dataSource && <span className="truncate">· {r.dataSource}</span>}
                  {r.tools.slice(0, 2).map((tool) => (
                    <span key={`${tool.kind}:${tool.key}`} className="px-1 rounded border" style={{ borderColor: ENTITY_GROUPS[tool.kind].color, color: ENTITY_GROUPS[tool.kind].color }}>
                      {tool.name}
                    </span>
                  ))}
                  {r.tools.length > 2 && <span>+{r.tools.length - 2}</span>}
                </div>
              </div>
            ))}
            {chain.sysmon.map((s) => (
              <div key={s.eventId} {...itemProps(`sysmon:${s.eventId}`)}>
                <div className="flex justify-between">
                  <span className="font-mono font-semibold" style={{ color: ENTITY_GROUPS.sysmon.color }}>EID {s.eventId}</span>
                  <span className="tabular-nums text-muted-foreground">{s.ruleCount}</span>
                </div>
                <div className="truncate">{s.name}</div>
              </div>
            ))}
            {chain.dataSources.map((d) => (
              <div key={d.pageId} {...itemProps(`ds:${d.pageId}`)}>
                <Link to={`/pages/${d.slug}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline line-clamp-2">
                  {d.title}
                </Link>
              </div>
            ))}

            {!rules.length && (
              <p className="absolute text-sm text-muted-foreground" style={{ top: HEAD, left: COLS.rule, width: WIDTH.rule }}>
                No rules cover this technique yet.
              </p>
            )}
            {!chain.sysmon.length && rules.length > 0 && (
              <p className="absolute text-xs text-muted-foreground" style={{ top: HEAD, left: COLS.sysmon, width: WIDTH.sysmon + WIDTH.ds }}>
                None of these rules is linked to a Sysmon event.
              </p>
            )}
            {rules.length > RULE_PAGE && (
              <button
                onClick={() => setShowAll((s) => !s)}
                className="absolute text-xs text-primary hover:underline"
                style={{ top: geo.height - 34, left: COLS.rule }}
              >
                {showAll ? 'Show fewer' : `Show all ${rules.length} rules`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
