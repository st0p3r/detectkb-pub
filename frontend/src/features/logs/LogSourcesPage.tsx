import React, { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Database, ListFilter, Loader2, ScrollText, Shield, Unplug } from 'lucide-react';
import { getLogEventPages, listLogEvents, listLogSources, type LogEventRow } from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { cn } from '@/lib/utils';

const PLATFORM_ORDER = ['Windows', 'Linux', 'EDR', 'Identity', 'Cloud', 'SaaS', 'Network', 'Containers', 'Multi-platform', 'Alerts', 'Other'];
const LIST_LIMIT = 50;

const eventLabel = (e: Pick<LogEventRow, 'code' | 'name'>) => (e.code === '*' ? 'Any event' : /^\d+$/.test(e.code) ? `${e.code} · ${e.name}` : e.name);

/** Rules and data source pages using one event. */
function EventPages({ event }: { event: LogEventRow }) {
  const { data, isLoading } = useQuery({ queryKey: ['log-event-pages', event.key], queryFn: () => getLogEventPages(event.key) });
  const [showAll, setShowAll] = React.useState(false);
  if (isLoading || !data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading rules…
      </p>
    );
  }
  const rules = showAll ? data.rules : data.rules.slice(0, LIST_LIMIT);
  return (
    <div className="space-y-4">
      <div>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          <Shield className="w-3.5 h-3.5" /> Detection rules reading it ({data.rules.length})
        </h4>
        {data.rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rule reads this event.</p>
        ) : (
          <ul className="space-y-1">
            {rules.map((p) => (
              <li key={p.id} className="flex items-center gap-2 flex-wrap text-sm">
                <Link to={`/pages/${p.slug}`} className="text-primary hover:underline">
                  {p.title}
                </Link>
                {p.status && <StatusBadge status={p.status} />}
                {p.severity && <SeverityBadge severity={p.severity} />}
              </li>
            ))}
            {data.rules.length > rules.length && (
              <li>
                <button onClick={() => setShowAll(true)} className="text-sm text-primary hover:underline">
                  Show all {data.rules.length.toLocaleString()}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {data.dataSources.length > 0 && (
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            <Database className="w-3.5 h-3.5" /> Data source pages ({data.dataSources.length})
          </h4>
          <ul className="space-y-1">
            {data.dataSources.map((p) => (
              <li key={p.id}>
                <Link to={`/pages/${p.slug}`} className="text-sm text-primary hover:underline">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Telemetry other than Sysmon: Windows event logs, PowerShell, auditd, EDR,
 * cloud logs — which events rules read, derived from their data sources.
 */
export function LogSourcesPage() {
  const [params, setParams] = useSearchParams();
  const focusEvent = params.get('event');
  const selected = params.get('source') ?? (focusEvent ? focusEvent.slice(0, focusEvent.indexOf(':')) : null);
  const { data: sources = [], isLoading } = useQuery({ queryKey: ['log-sources'], queryFn: listLogSources });
  const current = selected ?? sources.find((s) => s.key !== 'sysmon')?.key ?? null;
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['log-events', current],
    queryFn: () => listLogEvents(current!),
    enabled: !!current && current !== 'sysmon',
  });
  const openEvent = events.find((e) => e.key === focusEvent) ?? null;
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openEvent) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [openEvent]);

  const byPlatform = useMemo(() => {
    const groups = new Map<string, typeof sources>();
    for (const s of sources) groups.set(s.platform, [...(groups.get(s.platform) ?? []), s]);
    return Array.from(groups).sort((a, b) => PLATFORM_ORDER.indexOf(a[0]) - PLATFORM_ORDER.indexOf(b[0]));
  }, [sources]);
  const source = sources.find((s) => s.key === current);
  const withRules = sources.reduce((n, s) => n + (s.rules > 0 ? 1 : 0), 0);

  return (
    <div className="max-w-6xl">
      <Breadcrumbs items={[{ label: 'Log Sources' }]} />
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <ScrollText className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Log Sources</h1>
          <p className="text-sm text-muted-foreground">
            The telemetry your rules read — Windows event logs, PowerShell, Linux, EDR and cloud logs — detected from each rule's data
            sources, logsource or tables
          </p>
        </div>
        <span className="ml-auto px-3 py-1 rounded-full bg-muted text-sm font-medium">{withRules} sources in use</span>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </p>
      ) : (
        <div className="grid lg:grid-cols-[18rem_1fr] gap-4 items-start">
          <nav className="rounded-lg border border-border bg-card p-2 space-y-3" aria-label="Log sources">
            {byPlatform.map(([platform, list]) => (
              <div key={platform}>
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{platform}</div>
                {list.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setParams({ source: s.key })}
                    aria-current={current === s.key}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left',
                      current === s.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                    )}
                  >
                    <span className="truncate flex-1">{s.label}</span>
                    <span className={cn('text-xs tabular-nums', current === s.key ? 'opacity-80' : 'text-muted-foreground')}>{s.rules}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="space-y-4 min-w-0">
            {source && (
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold">{source.label}</h2>
                  <span className="text-sm text-muted-foreground">
                    {source.platform} · {source.rules.toLocaleString()} rule{source.rules === 1 ? '' : 's'}
                    {source.events > 0 && ` · ${source.events} event${source.events === 1 ? '' : 's'}`}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2 text-sm">
                    <Link to={`/rules?telemetry=${encodeURIComponent(source.key)}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <ListFilter className="w-4 h-4" /> Rules
                    </Link>
                    <Link to={`/graph?view=impact&sources=${encodeURIComponent(source.key)}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <Unplug className="w-4 h-4" /> What if we lose it?
                    </Link>
                  </div>
                </div>
                {source.key === 'sysmon' && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sysmon for Windows has its own reference with every event, key fields and detection tips.{' '}
                    <Link to="/sysmon-events" className="inline-flex items-center gap-1 text-primary hover:underline">
                      Open Sysmon events <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </p>
                )}
              </div>
            )}

            {current && current !== 'sysmon' && (
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                {eventsLoading ? (
                  <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading events…
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-4 py-2">Event</th>
                        <th className="text-right font-medium px-4 py-2 w-24">Rules</th>
                        <th className="text-right font-medium px-4 py-2 w-32">Data sources</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {events.map((e) => (
                        <tr
                          key={e.key}
                          onClick={() => setParams({ source: current, event: e.key })}
                          className={cn('cursor-pointer hover:bg-accent/50', focusEvent === e.key && 'bg-primary/10')}
                        >
                          <td className="px-4 py-2">
                            {e.code === '*' ? (
                              <span className="text-muted-foreground" title="Rules that name the product, not specific events">
                                Any event (product-level)
                              </span>
                            ) : (
                              eventLabel(e)
                            )}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{e.rules}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{e.dataSources || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {openEvent && (
              <div ref={detailRef} className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-semibold">
                    {openEvent.sourceLabel} · {eventLabel(openEvent)}
                  </h3>
                  <span className="font-mono text-xs text-muted-foreground">{openEvent.key}</span>
                  <div className="ml-auto flex flex-wrap gap-3 text-sm">
                    <Link to={`/rules?telemetry=${encodeURIComponent(openEvent.key)}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <ListFilter className="w-4 h-4" /> In the rule list
                    </Link>
                    <Link to={`/graph?view=impact&events=${encodeURIComponent(openEvent.key)}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <Unplug className="w-4 h-4" /> What if we lose it?
                    </Link>
                  </div>
                </div>
                <EventPages event={openEvent} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
