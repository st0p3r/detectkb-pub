import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Shield,
  Terminal,
  Pin,
  Link2Off,
  AlertCircle,
  Plus,
  Search,
  ArrowRight,
} from 'lucide-react';
import { listPages, listRules, listSplCommands, getBrokenLinks } from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
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
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  loading?: boolean;
  gradient: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'group rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
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
    </div>
  );
}

function WidgetCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card overflow-hidden transition-shadow duration-200 hover:shadow-md',
        className
      )}
    >
      <div className="px-5 py-3 border-b border-border">
        <h2 className="text-sm font-semibold">{title}</h2>
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

export function DashboardPage() {
  const navigate = useNavigate();

  const { data: pages, isLoading: pagesLoading } = useQuery({
    queryKey: ['pages'],
    queryFn: () => listPages(),
  });

  const { data: rules, isLoading: rulesLoading } = useQuery({
    queryKey: ['rules'],
    queryFn: () => listRules(),
  });

  const { data: splCommands, isLoading: splLoading } = useQuery({
    queryKey: ['spl'],
    queryFn: () => listSplCommands(),
  });

  const { data: brokenLinks, isLoading: brokenLoading } = useQuery({
    queryKey: ['broken-links'],
    queryFn: getBrokenLinks,
  });

  const pinnedPages = pages?.filter((p) => p.isPinned) ?? [];
  const recentPages = [...(pages ?? [])]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 8);

  const draftRules = rules?.filter((r) => r.status === 'draft').slice(0, 5) ?? [];

  const ruleCounts = {
    draft: rules?.filter((r) => r.status === 'draft').length ?? 0,
    testing: rules?.filter((r) => r.status === 'testing').length ?? 0,
    production: rules?.filter((r) => r.status === 'production').length ?? 0,
    deprecated: rules?.filter((r) => r.status === 'deprecated').length ?? 0,
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="animate-fade-in-up">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your detection engineering knowledge base at a glance.
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={BookOpen}
          label="Total Pages"
          value={pages?.length ?? 0}
          sub={<span className="text-xs text-muted-foreground">Knowledge articles</span>}
          loading={pagesLoading}
          gradient="from-blue-500 to-sky-600"
          className="animate-fade-in-up stagger-1"
        />
        <StatCard
          icon={Shield}
          label="Detection Rules"
          value={rules?.length ?? 0}
          sub={
            !rulesLoading && rules ? (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {ruleCounts.draft > 0 && (
                  <span className="text-xs text-muted-foreground">draft&nbsp;<strong className="text-foreground">{ruleCounts.draft}</strong></span>
                )}
                {ruleCounts.testing > 0 && (
                  <span className="text-xs text-muted-foreground">·&nbsp;testing&nbsp;<strong className="text-foreground">{ruleCounts.testing}</strong></span>
                )}
                {ruleCounts.production > 0 && (
                  <span className="text-xs text-muted-foreground">·&nbsp;prod&nbsp;<strong className="text-foreground">{ruleCounts.production}</strong></span>
                )}
                {ruleCounts.deprecated > 0 && (
                  <span className="text-xs text-muted-foreground">·&nbsp;dep&nbsp;<strong className="text-foreground">{ruleCounts.deprecated}</strong></span>
                )}
              </div>
            ) : undefined
          }
          loading={rulesLoading}
          gradient="from-red-500 to-rose-600"
          className="animate-fade-in-up stagger-2"
        />
        <StatCard
          icon={Terminal}
          label="SPL Commands"
          value={splCommands?.length ?? 0}
          sub={<span className="text-xs text-muted-foreground">In the library</span>}
          loading={splLoading}
          gradient="from-amber-500 to-orange-600"
          className="animate-fade-in-up stagger-3"
        />
        <StatCard
          icon={Pin}
          label="Pinned Pages"
          value={pinnedPages.length}
          sub={<span className="text-xs text-muted-foreground">Quick access</span>}
          loading={pagesLoading}
          gradient="from-violet-500 to-purple-600"
          className="animate-fade-in-up stagger-4"
        />
      </div>

      {/* Quick Actions */}
      <div className="animate-fade-in-up stagger-3">
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <QuickAction
            to="/pages/new"
            icon={Plus}
            title="New Page"
            description="Create knowledge article"
            gradient="from-indigo-500 to-violet-600"
          />
          <QuickAction
            to="/rules"
            icon={Shield}
            title="View Rules"
            description="Browse detection rules"
            gradient="from-red-500 to-rose-600"
          />
          <QuickAction
            to="/spl-library"
            icon={Terminal}
            title="SPL Library"
            description="Reusable SPL commands"
            gradient="from-amber-500 to-orange-600"
          />
          <QuickAction
            to="/search"
            icon={Search}
            title="Search"
            description="Find anything fast"
            gradient="from-blue-500 to-sky-600"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Rules in Draft */}
        <WidgetCard title="Rules in Draft" className="animate-fade-in-up stagger-4">
          {rulesLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading rules">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : draftRules.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No draft rules.</p>
          ) : (
            <ul className="space-y-2">
              {draftRules.map((rule) => (
                <li key={rule.id}>
                  <Link
                    to={`/pages/${rule.page.slug}`}
                    className="flex items-center justify-between gap-2 group rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">
                      {rule.page.title}
                    </span>
                    <StatusBadge status={rule.status} />
                  </Link>
                </li>
              ))}
              {(rules?.filter((r) => r.status === 'draft').length ?? 0) > 5 && (
                <li>
                  <Link to="/rules?status=draft" className="text-xs text-primary hover:underline">
                    View all draft rules →
                  </Link>
                </li>
              )}
            </ul>
          )}
        </WidgetCard>

        {/* Pinned Pages */}
        <WidgetCard title="Pinned Pages" className="animate-fade-in-up stagger-5">
          {pagesLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading pinned pages">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : pinnedPages.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No pinned pages. Pin a page from its view to add it here.
            </p>
          ) : (
            <ul className="space-y-2">
              {pinnedPages.map((page) => (
                <li key={page.id}>
                  <Link
                    to={`/pages/${page.slug}`}
                    className="flex items-center gap-2 group rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/40 transition-colors"
                  >
                    <TypeBadge type={page.type} />
                    <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">
                      {page.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      </div>

      {/* Recently Edited */}
      <WidgetCard title="Recent Activity" className="animate-fade-in-up stagger-6">
        {pagesLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading recent pages">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : recentPages.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No pages yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {recentPages.map((page) => (
              <div key={page.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 rounded-md px-2 -mx-2 hover:bg-muted/30 transition-colors">
                <Link
                  to={`/pages/${page.slug}`}
                  className="flex items-center gap-2 min-w-0 group"
                >
                  <TypeBadge type={page.type} />
                  <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">
                    {page.title}
                  </span>
                </Link>
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  {relativeTime(page.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </WidgetCard>

      {/* Broken Links */}
      <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-between gap-4 animate-fade-in-up stagger-6 transition-shadow duration-200 hover:shadow-md">
        <div className="flex items-center gap-3">
          <Link2Off className="w-5 h-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Broken Links</p>
            {brokenLoading ? (
              <Skeleton className="h-3 w-24 mt-1" />
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">
                {(brokenLinks?.length ?? 0) === 0
                  ? 'No broken links detected'
                  : `${brokenLinks!.length} broken link${brokenLinks!.length !== 1 ? 's' : ''} found`}
              </p>
            )}
          </div>
        </div>
        {(brokenLinks?.length ?? 0) > 0 && (
          <button
            onClick={() => navigate('/broken-links')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 active:scale-[0.98] transition-all"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            View broken links
          </button>
        )}
      </div>
    </div>
  );
}
