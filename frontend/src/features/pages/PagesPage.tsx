import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Plus, Pencil, Eye, Trash2, X } from 'lucide-react';
import { listPages, deletePage, getTags, listCategories, type PageListItem, type TagWithCount, type Category } from '@/lib/api';
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

export function PagesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryIdParam = searchParams.get('categoryId');
  const { types: pageTypes } = usePageTypes();

  const [pages, setPages] = useState<PageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmPage, setConfirmPage] = useState<PageListItem | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    getTags().then(setTags).catch(() => {});
    listCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    listPages({
      type: typeFilter || undefined,
      q: search || undefined,
      categoryId: categoryIdParam ? Number(categoryIdParam) : undefined,
    })
      .then(setPages)
      .finally(() => setLoading(false));
  }, [typeFilter, search, categoryIdParam]);

  const displayedPages = selectedTag
    ? pages.filter((p) => p.tags.some(({ tag }) => tag.name === selectedTag))
    : pages;

  async function handleDelete() {
    if (!confirmPage) return;
    setDeletingId(confirmPage.id);
    try {
      await deletePage(confirmPage.id);
      setPages((prev) => prev.filter((p) => p.id !== confirmPage.id));
    } finally {
      setDeletingId(null);
      setConfirmPage(null);
    }
  }

  const activeCategory = categoryIdParam
    ? categories.find((c) => c.id === Number(categoryIdParam))
    : null;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <BookOpen className="w-6 h-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">All Pages</h1>
          {activeCategory && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: activeCategory.color || '#6366f1' }}
            >
              {activeCategory.name}
              <button
                onClick={() => setSearchParams({})}
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

      {/* Type filter + search */}
      <div className="flex flex-wrap gap-3 mb-3">
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setTypeFilter('')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none ${
              typeFilter === ''
                ? 'bg-primary text-primary-foreground'
                : 'bg-accent text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          {pageTypes.map((t) => (
            <button
              key={t.name}
              onClick={() => setTypeFilter(t.name)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 outline-none ${
                typeFilter === t.name
                  ? 'text-white'
                  : 'bg-accent text-muted-foreground hover:text-foreground'
              }`}
              style={typeFilter === t.name ? { backgroundColor: t.color } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search pages..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search pages"
          className="ml-auto px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 w-56"
        />
      </div>

      {/* Tag filter chips */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setSelectedTag(null)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none ${
              selectedTag === null
                ? 'bg-primary/20 text-primary border border-primary/40'
                : 'bg-muted text-muted-foreground hover:text-foreground border border-transparent'
            }`}
          >
            All tags
          </button>
          {tags.map((tag) => {
            const color = tag.color;
            const isSelected = selectedTag === tag.name;
            return (
              <button
                key={tag.id}
                onClick={() => setSelectedTag(isSelected ? null : tag.name)}
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
      ) : displayedPages.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-16 text-center">
          <BookOpen className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">No pages yet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            {search || typeFilter || selectedTag
              ? 'No pages match the current filters. Try adjusting your search.'
              : 'Your knowledge base is empty. Create your first page to get started.'}
          </p>
          {!search && !typeFilter && !selectedTag && (
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
        <div className="rounded-lg border border-border bg-card overflow-hidden">
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
