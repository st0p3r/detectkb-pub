import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
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

function highlightSnippet(text: string, q: string): React.ReactNode {
  if (!q || !text) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <strong className="font-semibold text-foreground bg-yellow-100 dark:bg-yellow-900/40 rounded px-0.5">
        {text.slice(idx, idx + q.length)}
      </strong>
      {text.slice(idx + q.length)}
    </>
  );
}

interface ResultSectionProps {
  title: string;
  results: SearchResult[];
  q: string;
}

function ResultSection({ title, results, q }: ResultSectionProps) {
  if (results.length === 0) return null;
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
          {results.length}
        </span>
      </div>
      <div className="space-y-2">
        {results.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-border bg-card p-4 hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Link
                to={`/pages/${r.slug}`}
                className="font-medium hover:text-primary transition-colors"
              >
                {highlightSnippet(r.title, q)}
              </Link>
              <TypeBadge type={r.type as PageType} />
            </div>
            {r.snippet && (
              <p className="text-sm text-muted-foreground leading-relaxed font-mono">
                {highlightSnippet(r.snippet, q)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SearchPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const debouncedQ = useDebounce(query, 300);
  const [results, setResults] = useState<{ pages: SearchResult[]; rules: SearchResult[]; splCommands: SearchResult[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debouncedQ.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    search(debouncedQ)
      .then(setResults)
      .finally(() => setLoading(false));
  }, [debouncedQ]);

  const totalResults = results
    ? results.pages.length + results.rules.length + results.splCommands.length
    : 0;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Search className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      </div>

      {/* Search input */}
      <div className="relative mb-8">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search pages, rules, SPL commands..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        {loading && (
          <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* States */}
      {query.length < 2 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Type at least 2 characters to search
        </div>
      )}

      {query.length >= 2 && !loading && results && totalResults === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No results for &quot;<span className="font-medium text-foreground">{query}</span>&quot;
        </div>
      )}

      {/* Results */}
      {results && totalResults > 0 && (
        <>
          <ResultSection title="Pages" results={results.pages} q={debouncedQ} />
          <ResultSection title="Detection Rules" results={results.rules} q={debouncedQ} />
          <ResultSection title="SPL Commands" results={results.splCommands} q={debouncedQ} />
        </>
      )}
    </div>
  );
}
