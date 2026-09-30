import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, X } from 'lucide-react';
import type { GraphNode } from '@/lib/api';
import { usePageTypes } from '@/context/PageTypesContext';
import { ENTITY_GROUPS, TOOL_GROUPS, isPageGroup } from './graphStyle';

interface NodePanelProps {
  node: GraphNode;
  onClose: () => void;
  /** View-specific actions (Expand, Explore from here, …). */
  children?: React.ReactNode;
  neighbours?: GraphNode[];
  onSelectNeighbour?: (id: string) => void;
}

const btn = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent';

/** Details and navigation for the selected graph node. */
export function NodePanel({ node, onClose, children, neighbours, onSelectNeighbour }: NodePanelProps) {
  const { getLabelFor, getColorFor } = usePageTypes();
  const colorOf = (g: string) => (isPageGroup(g) ? getColorFor(g) : ENTITY_GROUPS[g]?.color ?? '#94a3b8');
  const rest = node.id.split(':').slice(1).join(':');

  return (
    <div data-export-ignore className="absolute top-3 right-3 w-80 max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border border-border bg-card/95 backdrop-blur shadow-lg p-4 text-sm z-10">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-xs text-muted-foreground">
            {isPageGroup(node.group) ? getLabelFor(node.group) : ENTITY_GROUPS[node.group]?.label} · {node.degree} connection
            {node.degree === 1 ? '' : 's'}
          </div>
          <div className="font-semibold">{node.label}</div>
          {node.gap ? (
            <div className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">No rule covers this — a detection gap</div>
          ) : node.ruleCount ? (
            <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
              {node.ruleCount} rule{node.ruleCount === 1 ? '' : 's'} {node.group === 'technique' ? 'mapped to it' : 'mention it'}
            </div>
          ) : null}
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-accent">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {children}
        {node.slug && (
          <Link to={`/pages/${node.slug}`} className={btn}>
            Open page
          </Link>
        )}
        {node.url && (
          <a href={node.url} target="_blank" rel="noreferrer" className={btn}>
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
      </div>

      {neighbours && neighbours.length > 0 && (
        <>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Connected in this view ({neighbours.length})
          </div>
          <ul className="space-y-0.5">
            {neighbours.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => onSelectNeighbour?.(n.id)}
                  className="w-full text-left flex items-center gap-2 px-1 py-0.5 rounded hover:bg-accent"
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colorOf(n.group) }} />
                  <span className="truncate">{n.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
