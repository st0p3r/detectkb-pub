import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, Shield, Terminal, Link2Off, Plus, Search, ArrowRight, Grid3x3, CheckCircle2 } from 'lucide-react';
import { getDashboard, getBrokenLinks } from '@/lib/api';
import { usePageTypes } from '@/context/PageTypesContext';
import { SOURCE_STYLES, sourceLabel } from '@/lib/ruleSource';
import { Skeleton } from '@/components/ui/Skeleton';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  loading,
  gradient,
  className,
  to,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  loading?: boolean;
  gradient: string;
  className?: string;
  /** Makes the whole card a link */
  to?: string;
}) {
  const Wrapper = to ? Link : 'div';
  return (
    <Wrapper
      to={to as string}
      className={cn(
        'group block rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
        to && 'hover:border-primary/40',
        className
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 text-white shadow-md bg-gradient-to-br transition-transform duration-200 group-hover:scale-105',
            gradient
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <>
              <Skeleton className="h-8 w-16 mt-1.5 mb-2" />
              <Skeleton className="h-3 w-32" />
            </>
          ) : (
            <>
              <p className="text-3xl font-bold tracking-tight mt-0.5 animate-count-up">{value}</p>
              {sub && <div className="mt-1">{sub}</div>}
            </>
          )}
        </div>
      </div>
    </Wrapper>
  );
}

function WidgetCard({
  title,
  children,
  className,
  action,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card overflow-hidden transition-shadow duration-200 hover:shadow-md',
        className
      )}
    >
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  title,
  description,
  gradient,
}: {
  to: string;
  icon: React.ElementType;
  title: string;
  description: string;
  gradient: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40 active:scale-[0.99]"
    >
      <div
        className={cn(
          'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-white bg-gradient-to-br',
          gradient
        )}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{description}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
    </Link>
  );
}

const STATUS_ORDER = ['draft', 'testing', 'production', 'deprecated'] as const;
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-400',
  testing: 'bg-amber-400',
  production: 'bg-emerald-500',
  deprecated: 'bg-rose-400',
};
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-sky-500',
  info: 'bg-slate-400',
};

/** One horizontal bar split into coloured segments (hover for the numbers). */
function StackedBar({ parts }: { parts: { key: string; count: number; color: string; label: string }[] }) {
  const total = parts.reduce((n, p) => n + p.count, 0);
  if (!total) return null;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((p) => `${p.label} ${p.count}`).join(', ')}>
      {parts
        .filter((p) => p.count > 0)
        .map((p) => (
          <span key={p.key} title={`${p.label}: ${p.count.toLocaleString()}`} className={cn('h-full', p.color)} style={{ width: `${(p.count / total) * 100}%` }} />
        ))}
    </div>
  );
}

/** Label, count and a proportional bar — one row of a breakdown list. */
function BarRow({ label, count, max, color, to }: { label: React.ReactNode; count: number; max: number; color: string; to: string }) {
  return (
    <Link to={to} className="group grid grid-cols-[9.5rem_1fr_3.5rem] items-center gap-3 rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/40">
      <span className="text-sm truncate group-hover:text-primary transition-colors">{label}</span>
      <span className="h-2 rounded-full bg-muted overflow-hidden">
        <span className={cn('block h-full rounded-full', color)} style={{ width: `${max ? Math.max((count / max) * 100, 2) : 0}%` }} />
      </span>
      <span className="text-sm tabular-nums text-right text-muted-foreground">{count.toLocaleString()}</span>
    </Link>
  );
}

function ListSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <div className="space-y-2" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { getLabelFor } = usePageTypes();
  // Counts and short lists from one small request (was: every page and rule)
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });
  const { data: brokenLinks, isLoading: brokenLoading } = useQuery({ queryKey: ['broken-links'], queryFn: getBrokenLinks });

  const pages = data?.pages;
  const rules = data?.rules;
  const knowledgeTypes = Object.entries(pages?.byType ?? {})
    .filter(([type]) => type !== 'RULE')
    .sort((a, b) => b[1] - a[1]);
  const knowledgeTotal = knowledgeTypes.reduce((n, [, c]) => n + c, 0);
  const coveragePct = rules?.coverage.total ? Math.round((rules.coverage.covered / rules.coverage.total) * 100) : 0;
  const brokenCount = brokenLinks?.length ?? 0;

  const sources = Object.entries(rules?.bySource ?? {}).sort((a, b) => b[1] - a[1]);
  const maxSource = Math.max(0, ...sources.map(([, c]) => c));
  const maxSeverity = Math.max(0, ...SEVERITY_ORDER.map((s) => rules?.bySeverity[s] ?? 0));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="animate-fade-in-up">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">Your detection engineering knowledge base at a glance.</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={BookOpen}
          label="Knowledge Pages"
          value={knowledgeTotal.toLocaleString()}
          to="/pages"
          sub={
            <p className="text-xs text-muted-foreground line-clamp-2">
              {knowledgeTypes.length
                ? knowledgeTypes.map(([type, n]) => `${n} ${getLabelFor(type).toLowerCase()}`).join(' · ')
                : 'Notes, concepts and data sources'}
            </p>
          }
          loading={isLoading}
          gradient="from-blue-500 to-sky-600"
          className="animate-fade-in-up stagger-1"
        />
        <StatCard
          icon={Shield}
          label="Detection Rules"
          value={(rules?.total ?? 0).toLocaleString()}
          to="/rules"
          sub={
            rules && (
              <div className="space-y-1.5 mt-1">
                <StackedBar
                  parts={STATUS_ORDER.map((s) => ({
                    key: s,
                    label: s,
                    count: rules.byStatus[s] ?? 0,
                    color: STATUS_COLORS[s],
                  }))}
                />
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{(rules.byStatus.production ?? 0).toLocaleString()}</strong> in production
                </p>
              </div>
            )
          }
          loading={isLoading}
          gradient="from-red-500 to-rose-600"
          className="animate-fade-in-up stagger-2"
        />
        <StatCard
          icon={Grid3x3}
          label="ATT&CK Coverage"
          value={`${coveragePct}%`}
          to="/attack-coverage"
          sub={
            rules && (
              <div className="space-y-1.5 mt-1">
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${coveragePct}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {rules.coverage.covered} of {rules.coverage.total} techniques
                </p>
              </div>
            )
          }
          loading={isLoading}
          gradient="from-emerald-500 to-teal-600"
          className="animate-fade-in-up stagger-3"
        />
        <StatCard
          icon={brokenCount ? Link2Off : CheckCircle2}
          label="Broken Links"
          value={brokenCount}
          to="/broken-links"
          sub={
            <p className={cn('text-xs', brokenCount ? 'text-destructive' : 'text-muted-foreground')}>
              {brokenCount ? 'Wiki links to missing pages' : 'Every [[link]] resolves'}
            </p>
          }
          loading={brokenLoading}
          gradient={brokenCount ? 'from-orange-500 to-red-600' : 'from-slate-400 to-slate-600'}
          className="animate-fade-in-up stagger-4"
        />
      </div>

      {/* Quick Actions */}
      <div className="animate-fade-in-up stagger-3">
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <QuickAction to="/pages/new" icon={Plus} title="New Page" description="Create knowledge article" gradient="from-indigo-500 to-violet-600" />
          <QuickAction to="/rules" icon={Shield} title="View Rules" description="Browse detection rules" gradient="from-red-500 to-rose-600" />
          <QuickAction
            to="/spl-library"
            icon={Terminal}
            title="SPL Library"
            description={pages ? `${pages.splCommands} reusable command${pages.splCommands === 1 ? '' : 's'}` : 'Reusable SPL commands'}
            gradient="from-amber-500 to-orange-600"
          />
          <QuickAction to="/search" icon={Search} title="Search" description="Find anything fast" gradient="from-blue-500 to-sky-600" />
        </div>
      </div>

      {rules && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WidgetCard title="Rules by Source" className="animate-fade-in-up stagger-4">
            <div className="space-y-0.5">
              {sources.map(([source, count]) => (
                <BarRow
                  key={source}
                  label={
                    <span className="inline-flex items-center gap-2">
                      <span className={cn('w-2 h-2 rounded-full', (SOURCE_STYLES[source as keyof typeof SOURCE_STYLES] ?? SOURCE_STYLES.manual).dot)} />
                      {sourceLabel(source)}
                    </span>
                  }
                  count={count}
                  max={maxSource}
                  color={(SOURCE_STYLES[source as keyof typeof SOURCE_STYLES] ?? SOURCE_STYLES.manual).dot}
                  to={`/rules?source=${source}`}
                />
              ))}
            </div>
          </WidgetCard>
          <WidgetCard title="Rules by Severity" className="animate-fade-in-up stagger-4">
            <div className="space-y-0.5">
              {SEVERITY_ORDER.map((s) => (
                <BarRow
                  key={s}
                  label={<span className="capitalize">{s}</span>}
                  count={rules.bySeverity[s] ?? 0}
                  max={maxSeverity}
                  color={SEVERITY_COLORS[s]}
                  to={`/rules?severity=${s}`}
                />
              ))}
            </div>
          </WidgetCard>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Rules in Draft */}
        <WidgetCard
          title="Rules in Draft"
          className="animate-fade-in-up stagger-5"
          action={
            (rules?.byStatus.draft ?? 0) > 0 && (
              <Link to="/rules?status=draft" className="text-xs text-primary hover:underline">
                All {rules!.byStatus.draft.toLocaleString()} →
              </Link>
            )
          }
        >
          {isLoading ? (
            <ListSkeleton rows={4} label="Loading rules" />
          ) : !rules?.drafts.length ? (
            <p className="text-sm text-muted-foreground italic">No draft rules.</p>
          ) : (
            <ul className="space-y-1">
              {rules.drafts.map((rule) => (
                <li key={rule.id}>
                  <Link
                    to={`/pages/${rule.page.slug}`}
                    className="flex items-center justify-between gap-2 group rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">{rule.page.title}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{relativeTime(rule.page.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>

        {/* Pinned Pages */}
        <WidgetCard title="Pinned Pages" className="animate-fade-in-up stagger-5">
          {isLoading ? (
            <ListSkeleton rows={3} label="Loading pinned pages" />
          ) : !pages?.pinned.length ? (
            <p className="text-sm text-muted-foreground italic">No pinned pages. Pin a page from its view to add it here.</p>
          ) : (
            <ul className="space-y-1">
              {pages.pinned.map((page) => (
                <li key={page.id}>
                  <Link
                    to={`/pages/${page.slug}`}
                    className="flex items-center gap-2 group rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/40 transition-colors"
                  >
                    <TypeBadge type={page.type} />
                    <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">{page.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      </div>

      {/* Recently Edited */}
      <WidgetCard title="Recent Activity" className="animate-fade-in-up stagger-6">
        {isLoading ? (
          <ListSkeleton rows={5} label="Loading recent pages" />
        ) : !pages?.recent.length ? (
          <p className="text-sm text-muted-foreground italic">No pages yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {pages.recent.map((page) => (
              <div
                key={page.id}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 rounded-md px-2 -mx-2 hover:bg-muted/30 transition-colors"
              >
                <Link to={`/pages/${page.slug}`} className="flex items-center gap-2 min-w-0 group">
                  <TypeBadge type={page.type} />
                  <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">{page.title}</span>
                </Link>
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{relativeTime(page.updatedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </WidgetCard>
    </div>
  );
}
