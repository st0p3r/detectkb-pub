import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

/** Page numbers to show around the current one, with gaps as null. */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const sorted = Array.from(pages).sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? [null, p] : [p]));
}

interface PaginationFooterProps {
  page: number;
  pageSize: number;
  total: number;
  /** Plural noun for the "Showing … of N" line, e.g. "rules" */
  noun: [singular: string, plural: string];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

/** Table footer: "Showing 51–100 of 2,143", per-page size and page buttons. */
export function PaginationFooter({ page, pageSize, total, noun, onPageChange, onPageSizeChange }: PaginationFooterProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
      <span>
        Showing {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()} of{' '}
        {total.toLocaleString()} {total === 1 ? noun[0] : noun[1]}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          Per page
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label={`${noun[1][0].toUpperCase()}${noun[1].slice(1)} per page`}
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
              onClick={() => onPageChange(page - 1)}
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
                  onClick={() => onPageChange(p)}
                  aria-current={p === page ? 'page' : undefined}
                  className={`min-w-[1.75rem] px-1.5 py-0.5 rounded ${p === page ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                >
                  {p}
                </button>
              )
            )}
            <button
              onClick={() => onPageChange(page + 1)}
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
  );
}
