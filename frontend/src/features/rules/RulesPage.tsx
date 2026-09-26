import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, PlusCircle, Search, FileUp, FileDown, ChevronDown, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import {
  SOURCE_FORMAT_LABELS,
  apiErrorMessage,
  downloadSigmaRules,
  listRulesPage,
  type RuleListParams,
  type RuleSortKey,
  type RuleSourceFormat,
} from '@/lib/api';
import { RuleImportDialog } from '@/features/rules/RuleImportDialog';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { relativeTime } from '@/lib/time';

const STATUS_OPTIONS = ['all', 'draft', 'testing', 'production', 'deprecated'] as const;
const SEVERITY_OPTIONS = ['all', 'info', 'low', 'medium', 'high', 'critical'] as const;

function splitChips(val?: string | null): string[] {
  if (!val) return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border last:border-0">
          <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-16" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
        </tr>
      ))}
    </>
  );
}

const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;
const SORT_KEYS: RuleSortKey[] = ['title', 'status', 'severity', 'updatedAt'];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Page numbers to show around the current one, with gaps as null. */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const sorted = Array.from(pages).sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? [null, p] : [p]));
}

export function RulesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Filters, sort and page live in the URL, so links (/rules?technique=T1003,
  // /rules?status=draft) and the back button work and views can be shared.
  const [params, setParams] = useSearchParams();
  const statusFilter = params.get('status') ?? 'all';
  const severityFilter = params.get('severity') ?? 'all';
  const sourceFilter = params.get('source') ?? 'all';
  const technique = params.get('technique') ?? '';
  const tactic = params.get('tactic') ?? '';
  const q = params.get('q') ?? '';
  const sortKey: RuleSortKey = SORT_KEYS.includes(params.get('sort') as RuleSortKey) ? (params.get('sort') as RuleSortKey) : 'updatedAt';
  const sortDir: 'asc' | 'desc' = params.get('dir') === 'asc' || params.get('dir') === 'desc' ? (params.get('dir') as 'asc' | 'desc') : sortKey === 'updatedAt' ? 'desc' : 'asc';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE;

  /** Update URL params; any change other than the page goes back to page 1. */
  const update = useCallback(
    (changes: Record<string, string | null>, opts?: { replace?: boolean }) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === null || v === '' || v === 'all') next.delete(k);
            else next.set(k, v);
          }
          if (!('page' in changes)) next.delete('page');
          return next;
        },
        { replace: opts?.replace }
      );
    },
    [setParams]
  );

  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebounced(search.trim(), 300);
  useEffect(() => {
    if (debouncedSearch !== q) update({ q: debouncedSearch }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [debouncedSearch]);
  // Back/forward (or a link) changed q: show it in the box
  useEffect(() => {
    if (q !== debouncedSearch) setSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the URL
  }, [q]);

  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const query: RuleListParams = {
    q: q || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    severity: severityFilter === 'all' ? undefined : severityFilter,
    source: sourceFilter === 'all' ? undefined : sourceFilter,
    technique: technique || undefined,
    tactic: tactic || undefined,
    sort: sortKey,
    dir: sortDir,
    page,
    pageSize,
  };
  const { data, isLoading, isFetching, isPlaceholderData, isError, error } = useQuery({
    queryKey: ['rules', 'page', query],
    queryFn: () => listRulesPage(query),
    // Keep the current rows on screen while the next page / filter loads
    placeholderData: keepPreviousData,
  });
  const rules = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const filtersActive = !!(q || technique || tactic) || [statusFilter, severityFilter, sourceFilter].some((f) => f !== 'all');

  // The server clamps a page past the end (e.g. after deleting rules); follow it
  useEffect(() => {
    if (data && !isPlaceholderData && data.page !== page) update({ page: data.page > 1 ? String(data.page) : null }, { replace: true });
  }, [data, isPlaceholderData, page, update]);

  async function handleExport(skeletons: boolean) {
    setExportMenuOpen(false);
    try {
      const count = await downloadSigmaRules({ skeletons });
      toast(
        count
          ? `Exported ${count} rule${count === 1 ? '' : 's'} as Sigma`
          : 'No rules have a Sigma source yet — use "All rules" to export skeletons',
        count ? 'success' : 'info'
      );
    } catch (err) {
      toast(apiErrorMessage(err, 'Export failed'), 'error');
    }
  }

  const statusCounts = { draft: 0, testing: 0, production: 0, deprecated: 0, ...data?.statusCounts };
  const allCount = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  function toggleSort(key: RuleSortKey) {
    if (sortKey === key) update({ sort: key, dir: sortDir === 'asc' ? 'desc' : 'asc' });
    // Newest and most severe first are the useful defaults for those columns
    else update({ sort: key, dir: key === 'updatedAt' || key === 'severity' ? 'desc' : 'asc' });
  }

  function clearFilters() {
    setSearch('');
    setParams(new URLSearchParams(pageSize === DEFAULT_PAGE_SIZE ? {} : { size: String(pageSize) }));
  }

  function SortIndicator({ col }: { col: RuleSortKey }) {
    if (sortKey !== col) return <span className="text-muted-foreground/40 ml-1">↕</span>;
    return <span className="ml-1 text-primary">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <Breadcrumbs items={[{ label: 'Detection Rules' }]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Detection Rules</h1>
          {data && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium" title="Rules matching the filters">
              {total.toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors"
            >
              <FileDown className="w-4 h-4" />
              Export Sigma
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {exportMenuOpen && (
              <div role="menu" className="absolute right-0 mt-1 w-64 z-20 rounded-md border border-border bg-card shadow-lg py-1 text-sm">
                <button role="menuitem" onClick={() => handleExport(false)} className="w-full text-left px-3 py-2 hover:bg-accent">
                  Rules with a Sigma source
                </button>
                <button role="menuitem" onClick={() => handleExport(true)} className="w-full text-left px-3 py-2 hover:bg-accent">
                  All rules
                  <span className="block text-xs text-muted-foreground">Others as skeletons to complete</span>
                </button>
              </div>
            )}
          </div>
          {hasPermission('rules:create') && (
            <>
              <button
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors"
              >
                <FileUp className="w-4 h-4" />
                Import rules
              </button>
              <button
                onClick={() => navigate('/pages/new?type=RULE')}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
              >
                <PlusCircle className="w-4 h-4" />
                New Rule
              </button>
            </>
          )}
        </div>
      </div>

      <RuleImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => queryClient.invalidateQueries({ queryKey: ['rules'] })}
      />

      {/* Status summary chips — counts under the other filters */}
      {data && allCount > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {(Object.entries(statusCounts) as [string, number][]).map(([status, count]) => (
            <button
              key={status}
              onClick={() => update({ status: statusFilter === status ? null : status })}
              aria-pressed={statusFilter === status}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none ${
                statusFilter === status
                  ? 'border-primary/60 ring-1 ring-primary/40'
                  : 'border-transparent hover:border-border'
              }`}
            >
              <StatusBadge status={status} />
              <span className="text-muted-foreground">{count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, technique, data source, rule id..."
            aria-label="Search rules"
            className="w-full pl-8 pr-8 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {isFetching && data && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" aria-label="Loading" />
          )}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => update({ status: e.target.value })}
          aria-label="Filter by status"
          className="px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              Status: {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={severityFilter}
          onChange={(e) => update({ severity: e.target.value })}
          aria-label="Filter by severity"
          className="px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              Severity: {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => update({ source: e.target.value })}
          aria-label="Filter by source"
          className="px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="all">Source: All</option>
          <option value="manual">Source: Written here</option>
          {(Object.keys(SOURCE_FORMAT_LABELS) as RuleSourceFormat[]).map((f) => (
            <option key={f} value={f}>
              Source: {SOURCE_FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
      </div>

      {/* Filters that arrive from links elsewhere (technique / tactic chips) */}
      {(technique || tactic) && (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
          <span className="text-muted-foreground">Filtered by</span>
          {[
            ['technique', technique, 'Technique'],
            ['tactic', tactic, 'Tactic'],
          ]
            .filter(([, v]) => v)
            .map(([key, value, label]) => (
              <span key={key} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                {label}: <span className="font-mono">{value}</span>
                <button onClick={() => update({ [key]: null })} aria-label={`Remove ${label.toLowerCase()} filter`} className="p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
        </div>
      )}

      {/* Table */}
      {isError ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-destructive">
          {apiErrorMessage(error, 'Could not load rules')}
        </div>
      ) : isLoading ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden" role="status" aria-label="Loading rules">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Severity</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">MITRE Techniques</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data Source</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Last Updated</th>
              </tr>
            </thead>
            <tbody>
              <SkeletonRows />
            </tbody>
          </table>
        </div>
      ) : total === 0 && !filtersActive ? (
        <div className="rounded-lg border border-border bg-card p-16 text-center">
          <Shield className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">No detection rules yet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Create your first detection rule to start tracking your security detections.
          </p>
          <button
            onClick={() => navigate('/pages/new?type=RULE')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
          >
            <PlusCircle className="w-4 h-4" />
            Create your first rule
          </button>
        </div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <p className="text-muted-foreground text-sm">No rules match the current filters.</p>
          <button
            onClick={clearFilters}
            className="mt-3 text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className={`rounded-lg border border-border bg-card overflow-hidden transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  <button
                    className="flex items-center gap-0.5 hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
                    onClick={() => toggleSort('title')}
                  >
                    Title <SortIndicator col="title" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  <button
                    className="flex items-center gap-0.5 hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
                    onClick={() => toggleSort('status')}
                  >
                    Status <SortIndicator col="status" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  <button
                    className="flex items-center gap-0.5 hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
                    onClick={() => toggleSort('severity')}
                  >
                    Severity <SortIndicator col="severity" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">MITRE Techniques</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data Source</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  <button
                    className="flex items-center gap-0.5 hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
                    onClick={() => toggleSort('updatedAt')}
                  >
                    Last Updated <SortIndicator col="updatedAt" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, idx) => {
                const techniques = splitChips(rule.mitreTechniques);
                return (
                  <tr
                    key={rule.id}
                    className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${
                      idx % 2 === 0 ? '' : 'bg-muted/10'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/pages/${rule.page.slug}`)}
                        className="font-medium text-primary hover:underline text-left focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
                      >
                        {rule.page.title}
                      </button>
                      {rule.page.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {rule.page.tags.slice(0, 3).map(({ tag }) => (
                            <span
                              key={tag.id}
                              className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs"
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={rule.status} />
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={rule.severity} />
                    </td>
                    <td className="px-4 py-3">
                      {techniques.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {techniques.slice(0, 4).map((t) => (
                            <button
                              key={t}
                              onClick={() => update({ technique: t })}
                              className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs font-mono hover:ring-1 hover:ring-blue-400 transition-all focus-visible:ring-2 focus-visible:ring-blue-400 outline-none"
                            >
                              {t}
                            </button>
                          ))}
                          {techniques.length > 4 && (
                            <span className="text-xs text-muted-foreground">+{techniques.length - 4}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {rule.dataSource ? (
                        <span className="font-mono text-xs text-foreground/80">{rule.dataSource}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {relativeTime(rule.page.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
            <span>
              Showing {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()} of{' '}
              {total.toLocaleString()} rules
            </span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5">
                Per page
                <select
                  value={pageSize}
                  onChange={(e) => update({ size: e.target.value === String(DEFAULT_PAGE_SIZE) ? null : e.target.value })}
                  aria-label="Rules per page"
                  className="px-1.5 py-1 rounded border border-border bg-background text-xs"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {pageCount > 1 && (
                <nav className="flex items-center gap-1" aria-label="Pagination">
                  <button
                    onClick={() => update({ page: page - 1 > 1 ? String(page - 1) : null })}
                    disabled={page <= 1}
                    aria-label="Previous page"
                    className="p-1 rounded hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {pageWindow(page, pageCount).map((p, i) =>
                    p === null ? (
                      <span key={`gap${i}`} className="px-1">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => update({ page: p > 1 ? String(p) : null })}
                        aria-current={p === page ? 'page' : undefined}
                        className={`min-w-[1.75rem] px-1.5 py-0.5 rounded ${
                          p === page ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    onClick={() => update({ page: String(page + 1) })}
                    disabled={page >= pageCount}
                    aria-label="Next page"
                    className="p-1 rounded hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </nav>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
