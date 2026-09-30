import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, ChevronDown, ChevronRight, HeartPulse, Info, Loader2 } from 'lucide-react';
import { apiErrorMessage, getDataHealth, type HealthCheck } from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { LINK_BASIS } from '@/lib/linkBasis';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const SEVERITY = {
  error: { icon: AlertOctagon, color: 'text-red-600 dark:text-red-400', ring: 'border-red-500/30' },
  warning: { icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400', ring: 'border-amber-500/30' },
  info: { icon: Info, color: 'text-sky-600 dark:text-sky-400', ring: 'border-border' },
} as const;

function CheckCard({ check }: { check: HealthCheck }) {
  const [open, setOpen] = useState(false);
  const s = SEVERITY[check.severity];
  const Icon = s.icon;
  const ok = check.count === 0;
  return (
    <div className={cn('rounded-lg border bg-card', ok ? 'border-border' : s.ring)}>
      <button onClick={() => !ok && setOpen((v) => !v)} className={cn('w-full flex items-start gap-3 p-4 text-left', !ok && 'hover:bg-accent/30')} aria-expanded={open}>
        <Icon className={cn('w-5 h-5 mt-0.5 flex-shrink-0', ok ? 'text-emerald-500' : s.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-medium">{check.title}</span>
            <span className={cn('text-lg font-semibold tabular-nums ml-auto', ok ? 'text-emerald-600 dark:text-emerald-400' : s.color)}>
              {ok ? '✓' : check.count.toLocaleString()}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{check.description}</p>
        </div>
        {!ok && (open ? <ChevronDown className="w-4 h-4 mt-1 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 mt-1 text-muted-foreground" />)}
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <ul className="space-y-1">
            {check.items.map((item, i) => (
              <li key={`${item.slug}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                {item.slug ? (
                  <Link to={`/pages/${item.slug}`} className="text-primary hover:underline">
                    {item.title}
                  </Link>
                ) : (
                  <span>{item.title}</span>
                )}
                {item.detail && <span className="text-xs text-muted-foreground font-mono break-all">{item.detail}</span>}
              </li>
            ))}
          </ul>
          {check.count > check.items.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing {check.items.length} of {check.count.toLocaleString()}.
            </p>
          )}
          {check.link && (
            <Link to={check.link} className="inline-block mt-2 text-sm text-primary hover:underline">
              Open the related page →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** Bar of how many links of each basis there are. */
function ProvenanceBar({ title, counts }: { title: string; counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const order = ['official', 'declared', 'manual', 'inferred', 'text-match'] as const;
  const colors: Record<string, string> = {
    official: 'bg-emerald-500',
    declared: 'bg-sky-500',
    manual: 'bg-violet-500',
    inferred: 'bg-amber-400',
    'text-match': 'bg-orange-400',
  };
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground tabular-nums">{total.toLocaleString()} links</span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
        {order.map((b) => (counts[b] ? <span key={b} className={colors[b]} style={{ width: `${(counts[b] / total) * 100}%` }} title={`${counts[b]} ${b}`} /> : null))}
      </div>
      <div className="flex flex-wrap gap-x-3 mt-1 text-xs text-muted-foreground">
        {order
          .filter((b) => counts[b])
          .map((b) => (
            <span key={b} title={LINK_BASIS[b].hint}>
              <span className={cn('inline-block w-2 h-2 rounded-full mr-1', colors[b])} />
              {counts[b].toLocaleString()} {LINK_BASIS[b].label}
            </span>
          ))}
      </div>
    </div>
  );
}

/** How well-grounded the links between rules, techniques, telemetry and tools are, and gaps in the data. */
export function DataHealthPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['data-health'], queryFn: getDataHealth });
  const issues = data?.checks.filter((c) => c.count > 0 && c.severity !== 'info').length ?? 0;
  return (
    <div className="max-w-5xl">
      <Breadcrumbs items={[{ label: 'Data Health' }]} />
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <HeartPulse className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data Health</h1>
          <p className="text-sm text-muted-foreground">Where each link comes from, and what in the data needs attention</p>
        </div>
        {data && (
          <span className="ml-auto text-xs text-muted-foreground">
            {data.rules.toLocaleString()} rules · checked {relativeTime(data.generatedAt)}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Checking…
        </p>
      ) : error || !data ? (
        <p className="text-destructive text-sm">{apiErrorMessage(error)}</p>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div>
              <h2 className="font-semibold">Where the links come from</h2>
              <p className="text-sm text-muted-foreground">
                <b>Declared</b> links are named by the rule itself; <b>inferred</b> ones are derived by DetectKB from the query or a Sigma
                category; <b>text matches</b> are tool names found in a rule. Techniques, groups and mitigations come from MITRE (official).
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-5">
              <ProvenanceBar title="Rule → Sysmon event" counts={data.provenance.sysmon} />
              <ProvenanceBar title="Rule → log event" counts={data.provenance.logs} />
              <ProvenanceBar
                title="Rule → attacker tool"
                counts={{ 'text-match': data.provenance.tools.inQuery + data.provenance.tools.outsideQuery }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Tool matches: {data.provenance.tools.inQuery.toLocaleString()} found in the query itself,{' '}
              {data.provenance.tools.outsideQuery.toLocaleString()} only in a title or description (listed below).
            </p>
          </section>

          <section>
            <h2 className="font-semibold mb-2">
              Checks{' '}
              <span className="text-sm font-normal text-muted-foreground">
                · {issues ? `${issues} need attention` : 'nothing needs attention'}
              </span>
            </h2>
            <div className="space-y-2">
              {data.checks.map((c) => (
                <CheckCard key={c.id} check={c} />
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
