import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { search, type SearchResult } from '@/lib/api';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { type PageType } from '@/lib/api';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQ = useDebounce(query, 200);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Fetch results
  useEffect(() => {
    if (debouncedQ.length < 2) {
      setResults([]);
      setSelectedIdx(0);
      return;
    }
    search(debouncedQ).then((data) => {
      const flat = [
        ...data.pages,
        ...data.rules,
        ...data.splCommands,
      ].slice(0, 8);
      setResults(flat);
      setSelectedIdx(0);
    });
  }, [debouncedQ]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
  }, []);

  const goTo = useCallback(
    (slug: string) => {
      navigate(`/pages/${slug}`);
      close();
    },
    [navigate, close]
  );

  // Keyboard nav inside the palette
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && results[selectedIdx]) {
      goTo(results[selectedIdx].slug);
      return;
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{ backdropFilter: 'blur(2px)', backgroundColor: 'rgba(0,0,0,0.4)' }}
    >
      <div
        className="w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, rules, SPL..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            esc
          </kbd>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <ul className="py-1.5 max-h-80 overflow-y-auto">
            {results.map((r, i) => (
              <li key={`${r.type}-${r.id}`}>
                <button
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === selectedIdx
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-accent text-foreground'
                  }`}
                  onMouseEnter={() => setSelectedIdx(i)}
                  onClick={() => goTo(r.slug)}
                >
                  <span className="flex-1 text-sm font-medium truncate">{r.title}</span>
                  <TypeBadge type={r.type as PageType} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {query.length >= 2 && results.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No results for &quot;<span className="font-medium text-foreground">{query}</span>&quot;
          </div>
        )}

        {query.length < 2 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            Type at least 2 characters to search
          </div>
        )}
      </div>
    </div>
  );
}
