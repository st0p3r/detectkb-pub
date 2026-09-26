import React, { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { listPageIds, listPagesPage, listRuleIds, listRulesPage, SOURCE_FORMAT_LABELS, type RuleSourceFormat } from '@/lib/api';
import { usePageTypes } from '@/context/PageTypesContext';
import { useDebounced } from '@/hooks/useDebounced';
import { useToast } from '@/hooks/useToast';
import { SOURCE_STYLES } from '@/lib/ruleSource';

const PAGE_SIZE = 50;
const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-500',
  low: 'text-sky-500',
  info: 'text-slate-400',
};

interface Row {
  id: number;
  title: string;
  /** Pages */
  type?: string;
  /** Rules */
  severity?: string;
  sourceFormat?: RuleSourceFormat | null;
}

interface SelectionPickerProps {
  kind: 'pages' | 'rules';
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
}

const selectCls = 'px-2 py-1.5 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50';

/**
 * Pick knowledge pages or rules for a report. Search and filters run on the
 * server and results load 50 at a time, so this stays quick with thousands of
 * rules; "Select all N matching" fetches just the ids.
 */
export function SelectionPicker({ kind, selected, onChange }: SelectionPickerProps) {
  const { toast } = useToast();
  const { types, getLabelFor } = usePageTypes();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300) || undefined;
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [source, setSource] = useState('');
  const [selectingAll, setSelectingAll] = useState(false);

  // Rules have their own picker, so the page picker leaves rule pages out
  const pageFilter = { q, type: type || undefined, excludeType: 'RULE' };
  const ruleFilter = { q, status: status || undefined, severity: severity || undefined, source: source || undefined };
  const filter = kind === 'pages' ? pageFilter : ruleFilter;

  const { data, isLoading, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['doc-picker', kind, filter],
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<{ rows: Row[]; total: number; page: number }> => {
      if (kind === 'pages') {
        const r = await listPagesPage({ ...pageFilter, sort: 'title', dir: 'asc', page: pageParam, pageSize: PAGE_SIZE });
        return {
          total: r.total,
          page: r.page,
          rows: r.items.map((p) => ({ id: p.id, title: p.title, type: p.type })),
        };
      }
      const r = await listRulesPage({ ...ruleFilter, sort: 'title', dir: 'asc', page: pageParam, pageSize: PAGE_SIZE });
      return {
        total: r.total,
        page: r.page,
        rows: r.items.map((rule) => ({ id: rule.id!, title: rule.page.title, severity: rule.severity, sourceFormat: rule.sourceFormat })),
      };
    },
    // The server clamps past the end, so stop once every row is loaded
    getNextPageParam: (last) => (last.page * PAGE_SIZE < last.total ? last.page + 1 : undefined),
  });

  const rows = data?.pages.flatMap((p) => p.rows) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const ids = kind === 'pages' ? await listPageIds(pageFilter) : await listRuleIds(ruleFilter);
      onChange(new Set([...selected, ...ids]));
    } catch {
      toast('Could not select all matching', 'error');
    } finally {
      setSelectingAll(false);
    }
  }

  const noun = kind === 'pages' ? 'Knowledge pages' : 'Detection rules';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="font-semibold text-sm">
          {noun}
          <span className="ml-2 font-normal text-muted-foreground">
            {selected.size.toLocaleString()} selected
          </span>
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={selectAllMatching}
            disabled={!total || selectingAll}
            className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {selectingAll && <Loader2 className="w-3 h-3 animate-spin" />}
            Select all {total.toLocaleString()} {q || type || status || severity || source ? 'matching' : ''}
          </button>
          <span className="text-muted-foreground">·</span>
          <button onClick={() => onChange(new Set())} disabled={!selected.size} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            Clear
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-2">
        <div className="relative flex-1 min-w-[10rem]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={kind === 'pages' ? 'Search pages…' : 'Search rules, techniques…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={`Search ${noun.toLowerCase()}`}
            className="w-full pl-7 pr-7 py-1.5 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {isFetching && !isFetchingNextPage && (
            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
        {kind === 'pages' ? (
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Page type" className={selectCls}>
            <option value="">All types</option>
            {types
              .filter((t) => t.name !== 'RULE')
              .map((t) => (
                <option key={t.name} value={t.name}>
                  {t.label}
                </option>
              ))}
          </select>
        ) : (
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Rule status" className={selectCls}>
              <option value="">Any status</option>
              {['draft', 'testing', 'production', 'deprecated'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Rule severity" className={selectCls}>
              <option value="">Any severity</option>
              {['critical', 'high', 'medium', 'low', 'info'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Rule source" className={selectCls}>
              <option value="">Any source</option>
              <option value="manual">Written here</option>
              {(Object.keys(SOURCE_FORMAT_LABELS) as RuleSourceFormat[]).map((f) => (
                <option key={f} value={f}>
                  {SOURCE_FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="max-h-64 overflow-y-auto space-y-0.5 -mx-1 px-1">
        {isLoading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-3">No {kind} match</p>
        ) : (
          <>
            <label className="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted/50 cursor-pointer">
              <input
                type="checkbox"
                checked={allShownSelected}
                onChange={() => {
                  const next = new Set(selected);
                  for (const r of rows) {
                    if (allShownSelected) next.delete(r.id);
                    else next.add(r.id);
                  }
                  onChange(next);
                }}
                className="w-3.5 h-3.5"
              />
              {allShownSelected ? 'Unselect' : 'Select'} the {rows.length.toLocaleString()} shown
            </label>
            {rows.map((row) => (
              <label key={row.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} className="w-3.5 h-3.5" />
                <span className="text-sm truncate flex-1" title={row.title}>
                  {row.title}
                </span>
                <span className="text-xs flex-shrink-0">
                  {row.type ? (
                    <span className="text-muted-foreground">{getLabelFor(row.type)}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      {row.sourceFormat && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${SOURCE_STYLES[row.sourceFormat]?.dot ?? ''}`}
                          title={SOURCE_FORMAT_LABELS[row.sourceFormat]}
                        />
                      )}
                      <span className={SEVERITY_COLOR[row.severity ?? ''] ?? 'text-muted-foreground'}>{row.severity}</span>
                    </span>
                  )}
                </span>
              </label>
            ))}
            {hasNextPage && (
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-primary hover:underline disabled:opacity-60"
              >
                {isFetchingNextPage && <Loader2 className="w-3 h-3 animate-spin" />}
                Show more ({(total - rows.length).toLocaleString()} left)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
