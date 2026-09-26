import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Pencil, Eye, Trash2, X, Search, Loader2 } from 'lucide-react';
import {
  listPagesPage,
  deletePage,
  getTags,
  listCategories,
  type PageListItem,
  type PageListParams,
  type PageSortKey,
} from '@/lib/api';
import { PAGE_SIZES, DEFAULT_PAGE_SIZE, PaginationFooter } from '@/components/ui/Pagination';
import { useDebounced } from '@/hooks/useDebounced';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { relativeTime } from '@/lib/time';
import { usePageTypes } from '@/context/PageTypesContext';

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border last:border-0">
          <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-20" /></td>
          <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-16" /></td>
          <td className="px-4 py-3"><Skeleton className="h-6 w-20 ml-auto" /></td>
        </tr>
      ))}
    </>
  );
}

const SORT_KEYS: PageSortKey[] = ['title', 'type', 'updatedAt'];
const TAG_CHIP_LIMIT = 12;

export function PagesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { types: pageTypes } = usePageTypes();

  // Filters, sort and page live in the URL (links from the sidebar's
  // categories, back button, shareable views)
  const [params, setParams] = useSearchParams();
  const categoryIdParam = params.get('categoryId');
  const typeFilter = params.get('type') ?? '';
  const selectedTag = params.get('tag');
  const q = params.get('q') ?? '';
  const sortKey: PageSortKey = SORT_KEYS.includes(params.get('sort') as PageSortKey) ? (params.get('sort') as PageSortKey) : 'updatedAt';
  const sortDir: 'asc' | 'desc' =
    params.get('dir') === 'asc' || params.get('dir') === 'desc' ? (params.get('dir') as 'asc' | 'desc') : sortKey === 'updatedAt' ? 'desc' : 'asc';
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
            if (v === null || v === '') next.delete(k);
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
  useEffect(() => {
    if (q !== debouncedSearch) setSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the URL
  }, [q]);

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmPage, setConfirmPage] = useState<PageListItem | null>(null);
  const [showAllTags, setShowAllTags] = useState(false);
  const { data: tags = [] } = useQuery({ queryKey: ['tags'], queryFn: () => getTags() });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: listCategories });

  const query: PageListParams = {
    q: q || undefined,
    type: typeFilter || undefined,
    tag: selectedTag || undefined,
    categoryId: categoryIdParam ? Number(categoryIdParam) : undefined,
    sort: sortKey,
    dir: sortDir,
    page,
    pageSize,
  };
  const { data, isLoading: loading, isFetching, isPlaceholderData } = useQuery({
    queryKey: ['pages', 'list', query],
    queryFn: () => listPagesPage(query),
    placeholderData: keepPreviousData,
  });
  const displayedPages = data?.items ?? [];
  const total = data?.total ?? 0;
  const typeCounts = data?.typeCounts ?? {};
  const allTypesCount = Object.values(typeCounts).reduce((a, b) => a + b, 0);

  // The server clamps a page past the end; follow it
  useEffect(() => {
    if (data && !isPlaceholderData && data.page !== page) update({ page: data.page > 1 ? String(data.page) : null }, { replace: true });
  }, [data, isPlaceholderData, page, update]);

  async function handleDelete() {
    if (!confirmPage) return;
    setDeletingId(confirmPage.id);
    try {
      await deletePage(confirmPage.id);
      await queryClient.invalidateQueries({ queryKey: ['pages'] });
    } finally {
      setDeletingId(null);
      setConfirmPage(null);
    }
  }

  function toggleSort(key: PageSortKey) {
    if (sortKey === key) update({ sort: key, dir: sortDir === 'asc' ? 'desc' : 'asc' });
    else update({ sort: key, dir: key === 'updatedAt' ? 'desc' : 'asc' });
  }

  function SortHeader({ col, children, className = '' }: { col: PageSortKey; children: React.ReactNode; className?: string }) {
    const active = sortKey === col;
    return (
      <th className={`text-left px-4 py-3 font-medium text-muted-foreground ${className}`} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button onClick={() => toggleSort(col)} className="flex items-center gap-0.5 hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none">
          {children}
          {active ? <span className="ml-1 text-primary">{sortDir === 'asc' ? '↑' : '↓'}</span> : <span className="text-muted-foreground/40 ml-1">↕</span>}
        </button>
      </th>
    );
  }

  const activeCategory = categoryIdParam
    ? categories.find((c) => c.id === Number(categoryIdParam))
    : null;
  const filtersActive = !!(q || typeFilter || selectedTag || categoryIdParam);
  // Most used tags first; the rest behind "more"
  const sortedTags = [...tags].sort((a, b) => b._count.pages - a._count.pages || a.name.localeCompare(b.name));
  const visibleTags = showAllTags ? sortedTags : sortedTags.slice(0, TAG_CHIP_LIMIT);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <BookOpen className="w-6 h-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">All Pages</h1>
          {data && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium" title="Pages matching the filters">
              {total.toLocaleString()}
            </span>
          )}
          {activeCategory && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: activeCategory.color || '#6366f1' }}
            >
              {activeCategory.name}
              <button
                onClick={() => update({ categoryId: null })}
                aria-label="Clear category filter"
                className="hover:opacity-70 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
        <Link
          to="/pages/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
        >
          <Plus className="w-4 h-4" />
          New Page
        </Link>
      </div>

      {/* Type filter (with counts under the other filters) + search */}
      <div className="flex flex-wrap gap-3 mb-3">
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => update({ type: null })}
            aria-pressed={typeFilter === ''}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none ${
              typeFilter === ''
                ? 'bg-primary text-primary-foreground'
                : 'bg-accent text-muted-foreground hover:text-foreground'
            }`}
          >
            All{data && <span className="ml-1.5 opacity-70 tabular-nums">{allTypesCount.toLocaleString()}</span>}
          </button>
          {pageTypes.map((t) => (
            <button
              key={t.name}
              onClick={() => update({ type: typeFilter === t.name ? null : t.name })}
              aria-pressed={typeFilter === t.name}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 outline-none ${
                typeFilter === t.name
                  ? 'text-white'
                  : 'bg-accent text-muted-foreground hover:text-foreground'
              }`}
              style={typeFilter === t.name ? { backgroundColor: t.color } : undefined}
            >
              {t.label}
              {data && <span className="ml-1.5 opacity-70 tabular-nums">{(typeCounts[t.name] ?? 0).toLocaleString()}</span>}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search titles and content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search pages"
            className="w-full pl-8 pr-8 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {isFetching && data && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" aria-label="Loading" />
          )}
        </div>
      </div>

      {/* Tag filter chips */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => update({ tag: null })}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none ${
              !selectedTag
                ? 'bg-primary/20 text-primary border border-primary/40'
                : 'bg-muted text-muted-foreground hover:text-foreground border border-transparent'
            }`}
          >
            All tags
          </button>
          {visibleTags.map((tag) => {
            const color = tag.color;
            const isSelected = selectedTag === tag.name;
            return (
              <button
                key={tag.id}
                onClick={() => update({ tag: isSelected ? null : tag.name })}
                aria-pressed={isSelected}
                className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none border"
                style={isSelected && color
                  ? { backgroundColor: color, color: 'white', borderColor: color }
                  : color
                  ? { borderColor: color, color }
                  : undefined}
              >
                {!isSelected && !color && <span className="text-muted-foreground">{tag.name}</span>}
                {(isSelected || color) && tag.name}
                <span className="ml-1 opacity-70">({tag._count.pages})</span>
              </button>
            );
          })}
          {sortedTags.length > TAG_CHIP_LIMIT && (
            <button onClick={() => setShowAllTags((v) => !v)} className="px-2.5 py-1 text-xs text-primary hover:underline">
              {showAllTags ? 'Fewer tags' : `+${sortedTags.length - TAG_CHIP_LIMIT} more`}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden" role="status" aria-label="Loading pages">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Tags</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              <SkeletonRows />
            </tbody>
          </table>
        </div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-border bg-card p-16 text-center">
          <BookOpen className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">{filtersActive ? 'No matching pages' : 'No pages yet'}</h2>
          <p className="text-muted-foreground text-sm mb-6">
            {filtersActive
              ? 'No pages match the current filters. Try adjusting your search.'
              : 'Your knowledge base is empty. Create your first page to get started.'}
          </p>
          {filtersActive ? (
            <button onClick={() => { setSearch(''); setParams(new URLSearchParams()); }} className="text-sm text-primary hover:underline">
              Clear filters
            </button>
          ) : (
            <Link
              to="/pages/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
            >
              <Plus className="w-4 h-4" />
              Create your first page
            </Link>
          )}
        </div>
      ) : (
        <div className={`rounded-lg border border-border bg-card overflow-hidden transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <SortHeader col="title">Title</SortHeader>
                <SortHeader col="type">Type</SortHeader>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Tags</th>
                <SortHeader col="updatedAt" className="hidden md:table-cell">Updated</SortHeader>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {displayedPages.map((page) => (
                <tr
                  key={page.id}
                  className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/pages/${page.slug}`}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {page.title}
                      {page.isPinned && (
                        <span className="ml-2 text-xs text-amber-500">pinned</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <TypeBadge type={page.type} />
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {page.tags.slice(0, 4).map(({ tag }) => (
                        <span
                          key={tag.id}
                          className="px-1.5 py-0.5 rounded text-xs font-medium text-white"
                          style={{ backgroundColor: tag.color || '#6b7280' }}
                        >
                          {tag.name}
                        </span>
                      ))}
                      {page.tags.length > 4 && (
                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs">
                          +{page.tags.length - 4}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell text-xs">
                    {relativeTime(page.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => navigate(`/pages/${page.slug}`)}
                        className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
                        title="View"
                        aria-label={`View ${page.title}`}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => navigate(`/pages/${page.slug}/edit`)}
                        className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
                        title="Edit"
                        aria-label={`Edit ${page.title}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmPage(page)}
                        disabled={deletingId === page.id}
                        className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-destructive/50 outline-none"
                        title="Delete"
                        aria-label={`Delete ${page.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={total}
            noun={['page', 'pages']}
            onPageChange={(p) => update({ page: p > 1 ? String(p) : null })}
            onPageSizeChange={(n) => update({ size: n === DEFAULT_PAGE_SIZE ? null : String(n) })}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmPage !== null}
        title="Delete Page"
        message={`Delete "${confirmPage?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmPage(null)}
      />
    </div>
  );
}
