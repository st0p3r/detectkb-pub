import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Eye, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { listPages, deletePage, type Page, type PageType } from '@/lib/api';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { relativeTime } from '@/lib/time';

interface FilteredPagesPageProps {
  type: PageType;
  title: string;
  icon: LucideIcon;
  emptyMessage: string;
  newLabel: string;
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b border-border last:border-0">
          <td className="px-4 py-3"><Skeleton className="h-4 w-52" /></td>
          <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-28" /></td>
          <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-16" /></td>
          <td className="px-4 py-3"><Skeleton className="h-6 w-20 ml-auto" /></td>
        </tr>
      ))}
    </>
  );
}

export function FilteredPagesPage({ type, title, icon: Icon, emptyMessage, newLabel }: FilteredPagesPageProps) {
  const navigate = useNavigate();
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmPage, setConfirmPage] = useState<Page | null>(null);

  useEffect(() => {
    setLoading(true);
    listPages({ type, q: search || undefined })
      .then(setPages)
      .finally(() => setLoading(false));
  }, [type, search]);

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

  return (
    <div className="max-w-5xl mx-auto">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: title }]} />

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Icon className="w-6 h-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {!loading && (
            <span className="text-sm text-muted-foreground">({pages.length})</span>
          )}
        </div>
        <Link
          to={`/pages/new?type=${type}`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
        >
          <Plus className="w-4 h-4" />
          {newLabel}
        </Link>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder={`Search ${title.toLowerCase()}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={`Search ${title}`}
          className="px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 w-64"
        />
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden" role="status" aria-label={`Loading ${title}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Tags</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody><SkeletonRows /></tbody>
          </table>
        </div>
      ) : pages.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-16 text-center">
          <Icon className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">No {title.toLowerCase()} yet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            {search
              ? `No ${title.toLowerCase()} match "${search}".`
              : emptyMessage}
          </p>
          {!search && (
            <Link
              to={`/pages/new?type=${type}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
            >
              <Plus className="w-4 h-4" />
              {newLabel}
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Tags</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
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
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {page.tags.slice(0, 4).map(({ tag }) => (
                        <span key={tag.id} className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs">
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
                        aria-label={`View ${page.title}`}
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => navigate(`/pages/${page.slug}/edit`)}
                        className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
                        aria-label={`Edit ${page.title}`}
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmPage(page)}
                        disabled={deletingId === page.id}
                        className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-destructive/50 outline-none"
                        aria-label={`Delete ${page.title}`}
                        title="Delete"
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
