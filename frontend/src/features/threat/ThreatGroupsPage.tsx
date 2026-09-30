import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Compass, ExternalLink, Grid3x3, Loader2, Search, Skull } from 'lucide-react';
import {
  apiErrorMessage,
  getAttackCoverage,
  getSoftware,
  getThreatGroup,
  listSoftware,
  listThreatGroups,
  type ActorCoverage,
  type ActorSummary,
  type ActorTechnique,
} from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { useDebounced } from '@/hooks/useDebounced';
import { cn } from '@/lib/utils';
import { safeHref } from '@/lib/safeUrl';

type Tab = 'groups' | 'software';
type Sort = 'techniques' | 'coverage' | 'gaps' | 'name';

const STATUS_FILTERS = [
  { value: '', label: 'Active rules' },
  { value: 'production', label: 'Production only' },
  { value: 'production,testing', label: 'Production + testing' },
];

const STATE_STYLE: Record<ActorTechnique['state'], { chip: string; label: string; hint: string }> = {
  covered: { chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', label: 'Covered', hint: 'Rules detect this technique' },
  parent: {
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    label: 'Parent only',
    hint: 'Only rules on the parent technique — the sub-technique may not be detected',
  },
  none: { chip: 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300', label: 'Gap', hint: 'No rule detects this technique' },
};

/** Green / amber / red bar of an actor's techniques. */
function CoverageBar({ c, className }: { c: Pick<ActorCoverage, 'total' | 'covered' | 'parentOnly'>; className?: string }) {
  const gaps = c.total - c.covered - c.parentOnly;
  const pct = (n: number) => `${c.total ? (n / c.total) * 100 : 0}%`;
  return (
    <span
      className={cn('flex h-2 rounded-full overflow-hidden bg-muted', className)}
      title={`${c.covered} covered · ${c.parentOnly} parent only · ${gaps} gaps`}
    >
      <span className="bg-emerald-500" style={{ width: pct(c.covered) }} />
      <span className="bg-amber-400" style={{ width: pct(c.parentOnly) }} />
      <span className="bg-red-400/70" style={{ width: pct(gaps) }} />
    </span>
  );
}

function sortActors<T extends ActorSummary>(list: T[], sort: Sort) {
  return [...list].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'coverage') return b.pct - a.pct || b.total - a.total;
    if (sort === 'gaps') return b.total - b.covered - (a.total - a.covered) || b.total - a.total;
    return b.total - a.total || a.name.localeCompare(b.name);
  });
}

/** Techniques of an actor, grouped by tactic, coloured by coverage. */
function TechniqueGrid({ coverage, onlyGaps }: { coverage: ActorCoverage; onlyGaps: boolean }) {
  const { data: attack } = useQuery({ queryKey: ['attack-coverage', 'all'], queryFn: () => getAttackCoverage('all'), staleTime: 5 * 60 * 1000 });
  const columns = useMemo(() => {
    const tactics = attack?.tactics ?? [];
    return tactics
      .map((t) => ({
        tactic: t,
        items: coverage.techniques.filter((x) => x.tactics.includes(t.shortname) && (!onlyGaps || x.state !== 'covered')),
      }))
      .filter((c) => c.items.length);
  }, [attack, coverage, onlyGaps]);
  if (!columns.length) return <p className="text-sm text-muted-foreground">{onlyGaps ? 'No gaps — every technique is covered.' : 'No techniques.'}</p>;
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {columns.map(({ tactic, items }) => (
        <div key={tactic.id}>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{tactic.name}</div>
          <div className="space-y-1">
            {items.map((t) => (
              <Link
                key={t.id}
                to={`/graph?view=chain&technique=${t.id}`}
                title={`${STATE_STYLE[t.state].hint}${t.rules ? ` · ${t.rules} rule${t.rules === 1 ? '' : 's'}` : ''} — open the detection chain`}
                className={cn('flex items-center gap-2 px-2 py-1 rounded border text-xs hover:shadow-sm', STATE_STYLE[t.state].chip)}
              >
                <span className="font-mono">{t.id}</span>
                <span className="truncate flex-1">{t.name}</span>
                {t.rules > 0 && <span className="tabular-nums opacity-80">{t.rules}</span>}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stats({ coverage }: { coverage: ActorCoverage }) {
  const gaps = coverage.total - coverage.covered - coverage.parentOnly;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        ['Techniques used', coverage.total, ''],
        ['Covered', `${coverage.covered} (${coverage.pct}%)`, 'text-emerald-600 dark:text-emerald-400'],
        ['Parent only', coverage.parentOnly, 'text-amber-600 dark:text-amber-400'],
        ['Gaps', gaps, 'text-red-600 dark:text-red-400'],
      ].map(([label, value, color]) => (
        <div key={label as string} className="rounded-lg border border-border px-3 py-2">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={cn('text-xl font-semibold tabular-nums', color as string)}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function ActorHeader({ id, name, aliases, description, url, node }: { id: string; name: string; aliases: string[]; description: string; url: string; node: string }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-xl font-semibold">{name}</h2>
        <span className="font-mono text-sm text-muted-foreground">{id}</span>
        <div className="ml-auto flex flex-wrap gap-3 text-sm">
          <Link to={`/attack-coverage?actor=${id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Grid3x3 className="w-4 h-4" /> In the ATT&CK matrix
          </Link>
          <Link to={`/graph?view=explore&focus=${node}`} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Compass className="w-4 h-4" /> Explore
          </Link>
          <a href={safeHref(url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            attack.mitre.org <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
      {aliases.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {aliases.map((a) => (
            <span key={a} className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground">
              {a}
            </span>
          ))}
        </div>
      )}
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

function GroupDetail({ id, status, onSoftware }: { id: string; status: string; onSoftware: (id: string) => void }) {
  const [onlyGaps, setOnlyGaps] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['threat-group', id, status], queryFn: () => getThreatGroup(id, status) });
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;
  if (error || !data) return <p className="text-sm text-destructive">{apiErrorMessage(error, 'Could not load the group')}</p>;
  return (
    <div className="space-y-5">
      <ActorHeader {...data} node={`group:${data.id}`} />
      <Stats coverage={data.coverage} />
      <section>
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-sm font-semibold">Techniques by tactic</h3>
          <label className="flex items-center gap-1.5 text-xs ml-auto">
            <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Only gaps and parent-only
          </label>
        </div>
        <TechniqueGrid coverage={data.coverage} onlyGaps={onlyGaps} />
      </section>
      {data.software.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">Malware and tools it uses ({data.software.length})</h3>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {data.software.map((s) => (
              <button key={s.id} onClick={() => onSoftware(s.id)} className="grid grid-cols-[1fr_6rem_3rem] items-center gap-2 text-left text-sm hover:text-primary">
                <span className="truncate">
                  {s.name} <span className="text-xs text-muted-foreground">{s.type}</span>
                </span>
                <CoverageBar c={s} />
                <span className="text-xs tabular-nums text-right text-muted-foreground">{s.pct}%</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SoftwareDetail({ id, status, onGroup }: { id: string; status: string; onGroup: (id: string) => void }) {
  const [onlyGaps, setOnlyGaps] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['software', id, status], queryFn: () => getSoftware(id, status) });
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;
  if (error || !data) return <p className="text-sm text-destructive">{apiErrorMessage(error, 'Could not load the software')}</p>;
  return (
    <div className="space-y-5">
      <ActorHeader {...data} node={`software:${data.id}`} />
      <p className="text-xs text-muted-foreground">
        {data.type === 'malware' ? 'Malware' : 'Tool'}
        {data.platforms.length > 0 && ` · ${data.platforms.join(', ')}`}
      </p>
      <Stats coverage={data.coverage} />
      <section>
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-sm font-semibold">Techniques by tactic</h3>
          <label className="flex items-center gap-1.5 text-xs ml-auto">
            <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Only gaps and parent-only
          </label>
        </div>
        <TechniqueGrid coverage={data.coverage} onlyGaps={onlyGaps} />
      </section>
      {data.groups.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">Groups known to use it ({data.groups.length})</h3>
          <div className="flex flex-wrap gap-1.5">
            {data.groups.map((g) => (
              <button key={g.id} onClick={() => onGroup(g.id)} className="px-2.5 py-1 rounded-full border border-border text-xs hover:bg-accent">
                {g.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** ATT&CK threat groups and software, and how well the rules cover the techniques each uses. */
export function ThreatGroupsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'software' ? 'software' : 'groups';
  const selected = tab === 'groups' ? params.get('group') : params.get('software');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<Sort>('techniques');
  const [swType, setSwType] = useState('');

  const groups = useQuery({ queryKey: ['threat-groups', q, status], queryFn: () => listThreatGroups({ q, status }), enabled: tab === 'groups', placeholderData: keepPreviousData });
  const software = useQuery({
    queryKey: ['software-list', q, status, swType],
    queryFn: () => listSoftware({ q, status, type: swType }),
    enabled: tab === 'software',
    placeholderData: keepPreviousData,
  });
  const list = useMemo(() => {
    const items: (ActorSummary & { sub?: string })[] =
      tab === 'groups'
        ? (groups.data ?? []).map((g) => ({ ...g, sub: g.aliases.slice(0, 3).join(', ') }))
        : (software.data ?? []).map((s) => ({ ...s, sub: `${s.type}${s.platforms.length ? ` · ${s.platforms.slice(0, 3).join(', ')}` : ''}` }));
    return sortActors(items, sort);
  }, [tab, groups.data, software.data, sort]);
  const loading = tab === 'groups' ? groups.isLoading : software.isLoading;

  const open = (next: { tab?: Tab; group?: string; software?: string }) => {
    const t = next.tab ?? tab;
    const p: Record<string, string> = t === 'software' ? { tab: 'software' } : {};
    if (next.group) p.group = next.group;
    if (next.software) p.software = next.software;
    setParams(p);
  };
  useEffect(() => {
    // Opening the first entry keeps the detail panel from being empty
    if (!selected && list.length && !q) open(tab === 'groups' ? { group: list[0].id } : { software: list[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the list first arrives
  }, [list.length > 0, tab]);

  return (
    <div className="max-w-full">
      <Breadcrumbs items={[{ label: 'Threat Groups' }]} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Skull className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Threat Groups & Software</h1>
          <p className="text-sm text-muted-foreground">
            MITRE ATT&CK groups, malware and tools — and how well your rules detect the techniques each one uses
          </p>
        </div>
        <div className="ml-auto flex rounded-lg border border-border bg-card p-0.5" role="tablist">
          {(
            [
              ['groups', 'Groups'],
              ['software', 'Malware & tools'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => open({ tab: k })}
              className={cn('px-3 py-1.5 rounded-md text-sm', tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[24rem_1fr] gap-4 items-start">
        <div className="rounded-lg border border-border bg-card">
          <div className="p-3 space-y-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                data-page-search
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tab === 'groups' ? 'Name or alias (APT34, OilRig)…' : 'Name or alias (Mimikatz)…'}
                aria-label="Search"
                className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className="flex-1 px-2 py-1.5 rounded-md border border-border bg-background text-xs">
                <option value="techniques">Most techniques</option>
                <option value="gaps">Most gaps</option>
                <option value="coverage">Best covered</option>
                <option value="name">Name</option>
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Rule status" className="flex-1 px-2 py-1.5 rounded-md border border-border bg-background text-xs">
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              {tab === 'software' && (
                <select value={swType} onChange={(e) => setSwType(e.target.value)} aria-label="Type" className="flex-1 px-2 py-1.5 rounded-md border border-border bg-background text-xs">
                  <option value="">Malware and tools</option>
                  <option value="malware">Malware</option>
                  <option value="tool">Tools</option>
                </select>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{list.length.toLocaleString()} {tab === 'groups' ? 'groups' : 'entries'}</div>
          </div>
          {loading ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </p>
          ) : (
            <ul className="max-h-[calc(100vh-17rem)] overflow-y-auto divide-y divide-border">
              {list.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => open(tab === 'groups' ? { group: a.id } : { software: a.id })}
                    aria-current={selected === a.id}
                    className={cn('w-full text-left px-3 py-2 hover:bg-accent/50', selected === a.id && 'bg-primary/10')}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium truncate">{a.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{a.id}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground" title={`${a.covered} of ${a.total} techniques covered`}>
                        {a.covered}/{a.total}
                      </span>
                    </div>
                    {a.sub && <div className="text-[11px] text-muted-foreground truncate">{a.sub}</div>}
                    <CoverageBar c={a} className="mt-1.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 min-w-0">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Pick a {tab === 'groups' ? 'group' : 'malware or tool'} to see its techniques and your coverage.</p>
          ) : tab === 'groups' ? (
            <GroupDetail id={selected} status={status} onSoftware={(id) => open({ tab: 'software', software: id })} />
          ) : (
            <SoftwareDetail id={selected} status={status} onGroup={(id) => open({ tab: 'groups', group: id })} />
          )}
        </div>
      </div>
    </div>
  );
}
