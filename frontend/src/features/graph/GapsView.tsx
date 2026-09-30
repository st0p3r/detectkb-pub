import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ShieldAlert } from 'lucide-react';
import { apiErrorMessage, getToolGaps, type ToolGaps } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ENTITY_GROUPS, TOOL_GROUPS } from './graphStyle';

interface GapsViewProps {
  onExplore: (id: string) => void;
}

const STEP = 30;

/** ATT&CK techniques attacker tools are known to use, and which tools no rule mentions. */
export function GapsView({ onExplore }: GapsViewProps) {
  const [kind, setKind] = useState('');
  const [onlyUncovered, setOnlyUncovered] = useState(false);
  const [shown, setShown] = useState(STEP);
  const { data, isLoading, isFetching, error } = useQuery({ queryKey: ['graph-gaps', kind], queryFn: () => getToolGaps(kind) });
  const techniques = (data?.techniques ?? []).filter((t) => !onlyUncovered || !t.rules);

  return (
    <div data-graph-export className="flex-1 min-h-0 overflow-auto space-y-3 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        {['', ...TOOL_GROUPS].map((k) => (
          <button
            key={k || 'all'}
            onClick={() => {
              setKind(k);
              setShown(STEP);
            }}
            aria-pressed={kind === k}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm border',
              kind === k ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent',
            )}
          >
            {k ? ENTITY_GROUPS[k].label : 'All tools'}
          </button>
        ))}
        <label className="flex items-center gap-2 text-sm ml-2">
          <input type="checkbox" checked={onlyUncovered} onChange={(e) => setOnlyUncovered(e.target.checked)} className="w-4 h-4" />
          Only techniques with no rule
        </label>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : error ? (
        <p className="text-sm text-destructive">{apiErrorMessage(error, 'Could not load gaps')}</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              [
                'Tools no rule mentions',
                `${data.summary.toolsWithoutRules.toLocaleString()} / ${data.summary.tools.toLocaleString()}`,
                'text-red-600 dark:text-red-400',
              ],
              ['Techniques they use', data.summary.techniques.toLocaleString(), 'text-foreground'],
              ['…with no rule at all', data.summary.techniquesWithoutRules.toLocaleString(), 'text-red-600 dark:text-red-400'],
              [
                'Tool coverage',
                `${data.summary.tools ? Math.round(((data.summary.tools - data.summary.toolsWithoutRules) / data.summary.tools) * 100) : 0}%`,
                'text-emerald-600 dark:text-emerald-400',
              ],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-lg border border-border bg-card p-4">
                <div className={cn('text-2xl font-bold tabular-nums', color)}>{value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Tools come from LOLBAS / GTFOBins / LOLDrivers with their ATT&CK mappings; a tool counts as covered when a rule's query or Sigma
            source mentions it. Red dashed: no rule mentions the tool.
          </p>

          <div className="space-y-2">
            {techniques.slice(0, shown).map((t) => (
              <div key={t.id} className={cn('rounded-lg border bg-card p-3', t.rules ? 'border-border' : 'border-red-500/40')}>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <button
                    onClick={() => onExplore(`technique:${t.id}`)}
                    className="flex items-center gap-2 text-sm font-medium hover:text-primary"
                  >
                    {!t.rules && <ShieldAlert className="w-4 h-4 text-red-500" />}
                    <span className="font-mono text-muted-foreground">{t.id}</span>
                    {t.name}
                  </button>
                  <span
                    className={cn(
                      'text-xs px-1.5 py-px rounded border',
                      t.rules ? 'border-border text-muted-foreground' : 'border-red-500/40 text-red-600 dark:text-red-400',
                    )}
                  >
                    {t.rules ? `${t.rules} rule${t.rules === 1 ? '' : 's'} on the technique` : 'no rule on the technique'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t.uncoveredTools} of {t.tools.length} tool{t.tools.length === 1 ? '' : 's'} not mentioned by any rule
                  </span>
                </div>
                <ToolChips tools={t.tools} />
              </div>
            ))}
          </div>
          {techniques.length > shown && (
            <button onClick={() => setShown((n) => n + STEP)} className="text-sm text-primary hover:underline">
              Show more ({techniques.length - shown} techniques left)
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

const CHIP_LIMIT = 30;

/** A technique's tools, uncovered first; long lists (LOLDrivers) collapse. */
function ToolChips({ tools }: { tools: ToolGaps['techniques'][number]['tools'] }) {
  const [all, setAll] = useState(false);
  const shown = all ? tools : tools.slice(0, CHIP_LIMIT);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((tool) => {
        const [k, key] = [tool.kind, tool.id.slice(tool.kind.length + 1)];
        return (
          <Link
            key={tool.id}
            to={`/attacker-tools?kind=${k}&key=${encodeURIComponent(key)}`}
            title={`${ENTITY_GROUPS[k]?.label}: ${tool.ruleCount ? `${tool.ruleCount} rule(s)` : 'no rule mentions it'}`}
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs hover:shadow',
              tool.ruleCount ? 'border-emerald-500/40 text-foreground' : 'border-dashed border-red-400 text-red-600 dark:text-red-400',
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ENTITY_GROUPS[k]?.color }} />
            {tool.name}
            {tool.ruleCount > 0 && <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">{tool.ruleCount}</span>}
          </Link>
        );
      })}
      {tools.length > shown.length && (
        <button onClick={() => setAll(true)} className="px-2 py-0.5 text-xs text-primary hover:underline">
          Show all {tools.length}
        </button>
      )}
    </div>
  );
}
