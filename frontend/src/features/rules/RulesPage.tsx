import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, PlusCircle, Search, FileUp, FileDown, ChevronDown, Loader2, X, Rows3, Rows4 } from 'lucide-react';
import {
  SOURCE_FORMAT_LABELS,
  apiErrorMessage,
  downloadSigmaRules,
  listRulesPage,
  type RuleListFilter,
  type RuleListParams,
  type RuleSortKey,
  type RuleSourceFormat,
} from '@/lib/api';
import { PAGE_SIZES, DEFAULT_PAGE_SIZE, PaginationFooter } from '@/components/ui/Pagination';
import { useDebounced } from '@/hooks/useDebounced';
import { RuleImportDialog } from '@/features/rules/RuleImportDialog';
import { RuleBulkBar } from '@/features/rules/RuleBulkBar';
import { SourceBadge } from '@/components/ui/SourceBadge';
import { SOURCE_STYLES, sourceLabel } from '@/lib/ruleSource';
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

const SORT_KEYS: RuleSortKey[] = ['title', 'status', 'severity', 'updatedAt'];

const DENSITY_KEY = 'detectkb.rulesDensity';

function readDensity(): 'comfortable' | 'compact' {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function Checkbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate;
      }}
      onChange={onChange}
      aria-label={label}
      className="w-4 h-4 rounded border-border accent-primary cursor-pointer align-middle"
    />
  );
}

const sortBtn =
  'flex items-center gap-0.5 hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none';

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
  const filtersActive = !!(q || technique || tactic) || [statusFilter, severityFilter, sourceFilter].some((f) => f !== 'all');

  // Selection: rule ids (kept across pages), or "every rule matching the filters"
  const listFilter: RuleListFilter = {
    q: query.q,
    status: query.status,
    severity: query.severity,
    source: query.source,
    technique: query.technique,
    tactic: query.tactic,
  };
  const filterKey = JSON.stringify(listFilter);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAllMatching(false);
  }, []);
  // A selection belongs to one filter; changing the filter drops it
  useEffect(clearSelection, [filterKey, clearSelection]);
  const pageIds = rules.map((r) => r.id!);
  const selectionCount = allMatching ? total : selected.size;

  function toggleOne(id: number) {
    if (allMatching) {
      // Leaving "all matching": keep this page minus the unticked rule
      setAllMatching(false);
      setSelected(new Set(pageIds.filter((x) => x !== id)));
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    if (allMatching) return clearSelection();
    const all = pageIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  useEffect(() => {
    if (!selectionCount) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea, [role=dialog], [role=toolbar]')) clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectionCount, clearSelection]);

  const [density, setDensity] = useState(readDensity);
  const compact = density === 'compact';
  const cellY = compact ? 'py-1.5' : 'py-3';
  function toggleDensity() {
    const next = compact ? 'comfortable' : 'compact';
    setDensity(next);
    try {
      localStorage.setItem(DENSITY_KEY, next);
    } catch {
      /* not remembered */
    }
  }

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

        <button
          onClick={toggleDensity}
          title={compact ? 'Comfortable rows' : 'Compact rows'}
          aria-label={compact ? 'Show comfortable rows' : 'Show compact rows'}
          aria-pressed={compact}
          className="px-2.5 py-2 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
        >
          {compact ? <Rows3 className="w-4 h-4" /> : <Rows4 className="w-4 h-4" />}
        </button>
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
                {['Title', 'Status', 'Severity', 'MITRE Techniques', 'Data Source', 'Last Updated'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground">
                    {h}
                  </th>
                ))}
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
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-10" />
              <col />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-52" />
              <col className="w-56" />
              <col className="w-28" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="pl-4 pr-0 py-3">
                  <Checkbox
                    checked={allMatching || (pageIds.length > 0 && pageIds.every((id) => selected.has(id)))}
                    indeterminate={!allMatching && pageIds.some((id) => selected.has(id)) && !pageIds.every((id) => selected.has(id))}
                    onChange={togglePage}
                    label="Select all rules on this page"
                  />
                </th>
                <th className={`text-left px-4 ${cellY} font-medium text-muted-foreground`}>
                  <button className={sortBtn} onClick={() => toggleSort('title')}>
                    Title <SortIndicator col="title" />
                  </button>
                </th>
                <th className={`text-left px-4 ${cellY} font-medium text-muted-foreground`}>
                  <button className={sortBtn} onClick={() => toggleSort('status')}>
                    Status <SortIndicator col="status" />
                  </button>
                </th>
                <th className={`text-left px-4 ${cellY} font-medium text-muted-foreground`}>
                  <button className={sortBtn} onClick={() => toggleSort('severity')}>
                    Severity <SortIndicator col="severity" />
                  </button>
                </th>
                <th className={`text-left px-4 ${cellY} font-medium text-muted-foreground`}>MITRE Techniques</th>
                <th className={`text-left px-4 ${cellY} font-medium text-muted-foreground`}>Data Source</th>
                <th className={`text-left px-4 ${cellY} font-medium text-muted-foreground`}>
                  <button className={sortBtn} onClick={() => toggleSort('updatedAt')}>
                    Updated <SortIndicator col="updatedAt" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const techniques = splitChips(rule.mitreTechniques);
                const shown = techniques.slice(0, compact ? 2 : 3);
                const isSelected = allMatching || selected.has(rule.id!);
                // Imports also tag rules with their format; the source badge already says it
                const tags = rule.page.tags.filter(({ tag }) => tag.name !== rule.sourceFormat);
                return (
                  <tr
                    key={rule.id}
                    className={`border-b border-border last:border-0 transition-colors ${
                      isSelected ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/30'
                    }`}
                  >
                    <td className={`pl-4 pr-0 ${cellY}`}>
                      <Checkbox checked={isSelected} onChange={() => toggleOne(rule.id!)} label={`Select ${rule.page.title}`} />
                    </td>
                    <td className={`px-4 ${cellY} min-w-0`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {compact && rule.sourceFormat && (
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${SOURCE_STYLES[rule.sourceFormat]?.dot ?? ''}`}
                            title={sourceLabel(rule.sourceFormat)}
                          />
                        )}
                        <Link
                          to={`/pages/${rule.page.slug}`}
                          title={rule.page.title}
                          className={`font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary/50 outline-none ${compact ? 'truncate' : 'line-clamp-2'}`}
                        >
                          {rule.page.title}
                        </Link>
                      </div>
                      {!compact && (rule.sourceFormat || tags.length > 0) && (
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          {rule.sourceFormat && <SourceBadge source={rule.sourceFormat} onClick={() => update({ source: rule.sourceFormat! })} />}
                          {tags.slice(0, 3).map(({ tag }) => (
                            <span key={tag.id} className="px-1.5 py-px rounded-full bg-muted text-muted-foreground text-[11px] leading-4">
                              #{tag.name}
                            </span>
                          ))}
                          {tags.length > 3 && (
                            <span className="text-[11px] text-muted-foreground" title={tags.slice(3).map(({ tag }) => tag.name).join(', ')}>
                              +{tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={`px-4 ${cellY}`}>
                      <StatusBadge status={rule.status} />
                    </td>
                    <td className={`px-4 ${cellY}`}>
                      <SeverityBadge severity={rule.severity} />
                    </td>
                    <td className={`px-4 ${cellY}`}>
                      {techniques.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {shown.map((t) => (
                            <button
                              key={t}
                              onClick={() => update({ technique: t })}
                              title={`Only rules for ${t}`}
                              className="px-1.5 py-px rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-[11px] leading-4 font-mono hover:ring-1 hover:ring-blue-400 transition-all focus-visible:ring-2 focus-visible:ring-blue-400 outline-none"
                            >
                              {t}
                            </button>
                          ))}
                          {techniques.length > shown.length && (
                            <span className="text-[11px] text-muted-foreground cursor-help" title={techniques.slice(shown.length).join(', ')}>
                              +{techniques.length - shown.length}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className={`px-4 ${cellY}`}>
                      {rule.dataSource ? (
                        <span
                          className={`block font-mono text-xs text-foreground/80 ${compact ? 'truncate' : 'line-clamp-2 break-words'}`}
                          title={rule.dataSource}
                        >
                          {rule.dataSource}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className={`px-4 ${cellY} text-muted-foreground text-xs whitespace-nowrap`} title={new Date(rule.page.updatedAt).toLocaleString()}>
                      {relativeTime(rule.page.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={total}
            noun={['rule', 'rules']}
            onPageChange={(p) => update({ page: p > 1 ? String(p) : null })}
            onPageSizeChange={(n) => update({ size: n === DEFAULT_PAGE_SIZE ? null : String(n) })}
          />
        </div>
      )}

      {selectionCount > 0 && (
        <RuleBulkBar
          count={selectionCount}
          target={allMatching ? { filter: listFilter } : { ids: Array.from(selected) }}
          canUpdate={hasPermission('rules:update')}
          canDelete={hasPermission('rules:delete')}
          selectAll={
            !allMatching && total > pageIds.length && pageIds.every((id) => selected.has(id))
              ? { total, onSelect: () => setAllMatching(true) }
              : undefined
          }
          onClear={clearSelection}
          onDone={() => {
            clearSelection();
            queryClient.invalidateQueries({ queryKey: ['rules'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      )}
    </div>
  );
}
