import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleOff, Rocket, Unplug } from 'lucide-react';
import { getCollectionOpportunities } from '@/lib/api';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { CollectionBadge } from './CollectionBadge';
import { useCollection } from './useCollection';

const READY_PREVIEW = 6;

/**
 * What the collection answers mean: rules with and without logs, draft rules
 * that could run today, and the log sources worth collecting next.
 */
export function CollectionSummary({ onPickSource }: { onPickSource: (source: string) => void }) {
  const collection = useCollection();
  const { data } = useQuery({ queryKey: ['collection-opportunities'], queryFn: getCollectionOpportunities });
  const [allReady, setAllReady] = useState(false);

  if (!collection.active) {
    return (
      <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <p className="font-medium">Which of these do you actually collect?</p>
        <p className="mt-1 text-muted-foreground max-w-3xl">
          A rule in production detects nothing if its logs never reach the SIEM. Mark each log source below as collected or not (single events can
          differ from their source). Coverage, the watchlist gaps and the health checks then leave out rules that cannot fire, and DetectKB shows
          which draft rules you could turn on today.
        </p>
      </div>
    );
  }

  const r = collection.rules;
  const ready = data?.ready ?? [];
  const shownReady = allReady ? ready : ready.slice(0, READY_PREVIEW);
  const sources = (data?.sources ?? []).filter((s) => s.rules > 0);

  return (
    <div className="mb-4 space-y-4">
      {r && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link to="/rules?logs=fed" className="rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/40">
            <div className="text-xs text-muted-foreground">Rules with logs collected</div>
            <div className="text-xl font-semibold tabular-nums">{r.fed.toLocaleString()}</div>
          </Link>
          <Link to="/rules?logs=blind" className="rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/40">
            <div className="text-xs text-muted-foreground">Rules that cannot fire</div>
            <div className="text-xl font-semibold tabular-nums">{r.blind.toLocaleString()}</div>
            {r.blindDeployed > 0 && (
              <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                <CircleOff className="w-3 h-3" /> {r.blindDeployed} of them deployed
              </div>
            )}
          </Link>
          <Link to="/rules?logs=unknown" className="rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/40">
            <div className="text-xs text-muted-foreground">Rules not decided yet</div>
            <div className="text-xl font-semibold tabular-nums">{r.unknown.toLocaleString()}</div>
          </Link>
          <Link to="/graph?view=impact&collection=1" className="rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/40">
            <div className="text-xs text-muted-foreground">What you miss today</div>
            <div className="flex items-center gap-1.5 mt-1 text-sm font-medium text-primary">
              <Unplug className="w-4 h-4" /> Lost rules and techniques <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </Link>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Rocket className="w-4 h-4 text-muted-foreground" /> Ready to turn on
            {data && <span className="font-normal text-muted-foreground">· {data.readyTotal} draft rule{data.readyTotal === 1 ? '' : 's'}</span>}
          </h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
            Draft rules whose logs you already collect
            {data && data.readyFillingGaps > 0 && `; ${data.readyFillingGaps} cover a technique no deployed rule covers`}.
          </p>
          {ready.length === 0 ? (
            <p className="text-sm text-muted-foreground">No draft rule reads only what is marked as collected.</p>
          ) : (
            <ul className="space-y-1.5">
              {shownReady.map((rule) => (
                <li key={rule.pageId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  <Link to={`/pages/${rule.slug}`} className="text-primary hover:underline">
                    {rule.title}
                  </Link>
                  <SeverityBadge severity={rule.severity} />
                  {rule.fills.length > 0 && (
                    <span className="text-xs text-muted-foreground" title={rule.fills.map((t) => `${t.id} ${t.name}`).join('\n')}>
                      closes {rule.fills.map((t) => t.id).join(', ')}
                    </span>
                  )}
                </li>
              ))}
              {ready.length > shownReady.length && (
                <li>
                  <button onClick={() => setAllReady(true)} className="text-xs text-primary hover:underline">
                    Show {ready.length - shownReady.length} more
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Worth collecting next</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
            Sources that are not collected or not decided, by the rules waiting for them and the techniques those rules would newly cover.
          </p>
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every source your rules read is collected.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium pb-1">Log source</th>
                  <th className="text-right font-medium pb-1">Rules waiting</th>
                  <th className="text-right font-medium pb-1">New techniques</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sources.slice(0, 10).map((s) => (
                  <tr key={s.source}>
                    <td className="py-1.5">
                      <button onClick={() => onPickSource(s.source)} className="text-primary hover:underline text-left">
                        {s.label}
                      </button>{' '}
                      <CollectionBadge state={s.state} className="ml-1" />
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      <Link to={`/rules?telemetry=${encodeURIComponent(s.source)}`} className="hover:underline">
                        {s.rules}
                      </Link>
                    </td>
                    <td className="py-1.5 text-right tabular-nums" title={s.techniques.map((t) => `${t.id} ${t.name}`).join('\n')}>
                      {s.techniqueCount || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
