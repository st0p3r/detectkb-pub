import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, PlusCircle, Search, FileUp, FileDown, ChevronDown } from 'lucide-react';
import { apiErrorMessage, downloadSigmaRules, listRules, type RuleWithPage } from '@/lib/api';
import { SigmaImportDialog } from '@/features/sigma/SigmaImportDialog';
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

export function RulesPage() {
  const navigate = useNavigate();
  const [rules, setRules] = useState<RuleWithPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<'title' | 'status' | 'severity' | 'updatedAt'>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    listRules()
      .then(setRules)
      .finally(() => setLoading(false));
  }, [reloadKey]);

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

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { draft: 0, testing: 0, production: 0, deprecated: 0 };
    for (const r of rules) {
      if (r.status in counts) counts[r.status]++;
    }
    return counts;
  }, [rules]);

  const filtered = useMemo(() => {
    let list = [...rules];

    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter);
    if (severityFilter !== 'all') list = list.filter((r) => r.severity === severityFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.page.title.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      let av: string;
      let bv: string;
      if (sortKey === 'title') {
        av = a.page.title.toLowerCase();
        bv = b.page.title.toLowerCase();
      } else if (sortKey === 'updatedAt') {
        av = a.page.updatedAt;
        bv = b.page.updatedAt;
      } else {
        av = a[sortKey] ?? '';
        bv = b[sortKey] ?? '';
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [rules, statusFilter, severityFilter, search, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function SortIndicator({ col }: { col: typeof sortKey }) {
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
          {!loading && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
              {rules.length}
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
                Import Sigma
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

      <SigmaImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => setReloadKey((k) => k + 1)}
      />

      {/* Status summary chips */}
      {!loading && rules.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {(Object.entries(statusCounts) as [string, number][]).map(([status, count]) => (
            <button
              key={status}
              onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none ${
                statusFilter === status
                  ? 'border-primary/60 ring-1 ring-primary/40'
                  : 'border-transparent hover:border-border'
              }`}
            >
              <StatusBadge status={status} />
              <span className="text-muted-foreground">{count}</span>
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
            placeholder="Search by title..."
            aria-label="Search rules"
            className="w-full pl-8 pr-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
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
          onChange={(e) => setSeverityFilter(e.target.value)}
          aria-label="Filter by severity"
          className="px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              Severity: {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
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
      ) : rules.length === 0 ? (
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
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <p className="text-muted-foreground text-sm">No rules match the current filters.</p>
          <button
            onClick={() => { setSearch(''); setStatusFilter('all'); setSeverityFilter('all'); }}
            className="mt-3 text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
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
              {filtered.map((rule, idx) => {
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
                              onClick={() => navigate(`/rules?technique=${encodeURIComponent(t)}`)}
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
          {filtered.length > 0 && (
            <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
              Showing {filtered.length} of {rules.length} rules
            </div>
          )}
        </div>
      )}
    </div>
  );
}
