import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Search, X } from 'lucide-react';
import type { GraphNode } from '@/lib/api';
import { TOOL_GROUPS } from './graphStyle';
import { useGroupStyle } from './useGroupStyle';
import { safeHref } from '@/lib/safeUrl';

interface NodePanelProps {
  node: GraphNode;
  onClose: () => void;
  /** View-specific actions (Expand, Explore from here, …). */
  children?: React.ReactNode;
  neighbours?: GraphNode[];
  onSelectNeighbour?: (id: string) => void;
}

const btn = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent';
/** Above this many connections a filter box appears. */
const FILTER_FROM = 12;

/**
 * Details and navigation for the selected graph node: a column beside the
 * canvas on wide screens (so it never covers the graph), a sheet over it on
 * narrow ones.
 */
export function NodePanel({ node, onClose, children, neighbours, onSelectNeighbour }: NodePanelProps) {
  const { colorOf, labelOf } = useGroupStyle();
  const [filter, setFilter] = useState('');
  const rest = node.id.split(':').slice(1).join(':');

  // Connections by kind, the biggest kind first
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const by = new Map<string, GraphNode[]>();
    for (const n of neighbours ?? []) {
      if (q && !n.label.toLowerCase().includes(q)) continue;
      by.set(n.group, [...(by.get(n.group) ?? []), n]);
    }
    return Array.from(by).sort((a, b) => b[1].length - a[1].length || labelOf(a[0]).localeCompare(labelOf(b[0])));
  }, [neighbours, filter, labelOf]);
  const total = neighbours?.length ?? 0;

  return (
    <aside
      data-export-ignore
      aria-label="Selected node"
      className="absolute inset-x-3 bottom-3 z-20 max-h-[60%] lg:static lg:inset-auto lg:max-h-none lg:w-80 lg:shrink-0 flex flex-col rounded-lg border border-border bg-card shadow-lg lg:shadow-none text-sm overflow-hidden"
    >
      <div className="p-4 pb-3 border-b border-border">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(node.group) }} />
              {labelOf(node.group)} · {node.degree} connection{node.degree === 1 ? '' : 's'}
            </div>
            <div dir="auto" className="mt-0.5 font-semibold leading-snug break-words">{node.label}</div>
            {node.gap ? (
              <div className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">No rule covers this — a detection gap</div>
            ) : node.ruleCount ? (
              <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                {node.ruleCount} rule{node.ruleCount === 1 ? '' : 's'} {node.group === 'technique' ? 'mapped to it' : 'mention it'}
              </div>
            ) : null}
          </div>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)" className="p-1 -mr-1 rounded hover:bg-accent shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          {children}
          {node.slug && (
            <Link to={`/pages/${node.slug}`} className={btn}>
              Open page
            </Link>
          )}
          {node.group === 'RULE' && node.slug && (
            <Link to={`/runbook/${node.slug}`} className={btn}>
              Runbook
            </Link>
          )}
          {node.url && (
            <a href={safeHref(node.url)} target="_blank" rel="noreferrer" className={btn}>
              ATT&CK <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {node.group === 'sysmon' && (
            <Link to={`/sysmon-events?event=${rest}`} className={btn}>
              Sysmon reference
            </Link>
          )}
          {TOOL_GROUPS.includes(node.group) && (
            <Link to={`/attacker-tools?kind=${node.group}&key=${encodeURIComponent(rest)}`} className={btn}>
              Tool reference
            </Link>
          )}
          {node.group === 'logevent' && (
            <Link to={`/log-sources?event=${encodeURIComponent(rest)}`} className={btn}>
              Log source reference
            </Link>
          )}
          {node.group === 'threat-group' && (
            <Link to={`/threat-groups?group=${rest}`} className={btn}>
              Coverage
            </Link>
          )}
          {node.group === 'software' && (
            <Link to={`/threat-groups?tab=software&software=${rest}`} className={btn}>
              Coverage
            </Link>
          )}
          {node.group === 'story' && (
            <Link to={`/analytic-stories?story=${rest}`} className={btn}>
              Story
            </Link>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
        {total === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing in this view is connected to it.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Connected here ({total})</span>
            </div>
            {total >= FILTER_FROM && (
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter connections…"
                  aria-label="Filter connections"
                  className="w-full pl-7 pr-2 py-1 rounded-md border border-border bg-background text-xs"
                />
              </div>
            )}
            {groups.length === 0 && <p className="text-xs text-muted-foreground">No connection matches “{filter}”.</p>}
            {groups.map(([group, list]) => (
              <section key={group} className="mb-3 last:mb-0">
                <h4 className="flex items-center gap-1.5 mb-0.5 text-[11px] font-medium text-muted-foreground">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorOf(group) }} />
                  {labelOf(group)} <span className="tabular-nums">{list.length}</span>
                </h4>
                <ul>
                  {list.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => onSelectNeighbour?.(n.id)}
                        title={n.label}
                        className="w-full text-left flex items-center gap-2 pl-3.5 pr-1 py-0.5 rounded hover:bg-accent"
                      >
                        <span dir="auto" className="truncate flex-1">{n.label}</span>
                        {n.gap && <span className="text-[10px] text-red-600 dark:text-red-400 shrink-0">no rule</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
