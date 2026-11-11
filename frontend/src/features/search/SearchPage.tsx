import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Grid3x3, Loader2, Search } from 'lucide-react';
import { apiErrorMessage, search, type PageType, type SearchResult } from '@/lib/api';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { useDebounced } from '@/hooks/useDebounced';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text with every searched word marked. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="font-semibold text-foreground bg-yellow-100 dark:bg-yellow-900/40 rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

function ResultSection({ title, results, total, terms, more }: { title: string; results: SearchResult[]; total: number; terms: string[]; more?: string }) {
  if (results.length === 0) return null;
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium tabular-nums">{total.toLocaleString()}</span>
        {total > results.length && (
          <span className="text-xs text-muted-foreground">
            the best {results.length} are shown
            {more && (
              <>
                {' · '}
                <Link to={more} className="text-primary hover:underline">
                  see all in the list
                </Link>
              </>
            )}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {results.map((r) => (
          <div key={r.id} className="rounded-lg border border-border bg-card p-4 hover:bg-muted/20 transition-colors">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <Link to={`/pages/${r.slug}`} dir="auto" className="font-medium hover:text-primary transition-colors">
                <Highlight text={r.title} terms={terms} />
              </Link>
              <TypeBadge type={r.type as PageType} />
              {r.status && <StatusBadge status={r.status} />}
              {r.severity && <SeverityBadge severity={r.severity} />}
              {r.matchedIn !== 'Title' && <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">found in: {r.matchedIn}</span>}
            </div>
            {r.snippet && (
              <p dir="auto" className="text-sm text-muted-foreground leading-relaxed break-words">
                <Highlight text={r.snippet} terms={terms} />
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Search across pages, rules, SPL commands and ATT&CK techniques; the query lives in the URL (?q=). */
export function SearchPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [query, setQuery] = useState(q);
  const debounced = useDebounced(query.trim(), 300);
  useDocumentTitle(q ? `Search: ${q}` : null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // Typing updates the URL (so a search can be shared and Back returns to it)
  useEffect(() => {
    if (debounced !== q) setParams(debounced ? { q: debounced } : {}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [debounced]);
  // Back / forward, or a link with another query
  useEffect(() => {
    if (q !== debounced) setQuery(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the URL
  }, [q]);

  const enabled = q.length >= 2;
  const { data, isFetching, error } = useQuery({ queryKey: ['search', q], queryFn: () => search(q), enabled, placeholderData: keepPreviousData });
  const results = enabled ? data : undefined;
  const terms = results?.terms ?? [];
  const found = results ? results.pages.length + results.rules.length + results.splCommands.length + results.techniques.length : 0;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Search className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      </div>

      <div className="relative mb-2">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          dir="auto"
          placeholder="Search pages, rules, queries, techniques…"
          aria-label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-10 pr-10 py-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        {isFetching && enabled && <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" aria-label="Searching" />}
      </div>
      <p className="mb-8 text-xs text-muted-foreground">
        Every word has to appear. Searches titles, text, tags, queries (SPL, KQL, EQL, Sigma), ATT&CK technique IDs and names, data sources, false positives and
        runbook steps.
      </p>

      {query.trim().length < 2 && <div className="text-center py-16 text-muted-foreground text-sm">Type at least 2 characters to search</div>}

      {error && enabled && <div className="text-center py-16 text-sm text-destructive">{apiErrorMessage(error, 'The search failed')}</div>}

      {enabled && results && !isFetching && found === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Nothing contains {terms.length > 1 ? 'all of ' : ''}
          <span dir="auto" className="font-medium text-foreground">
            “{q}”
          </span>
          {terms.length > 1 && '. Try fewer words.'}
        </div>
      )}

      {results && found > 0 && (
        <>
          {results.techniques.length > 0 && (
            <section className="mb-8">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                <Grid3x3 className="w-4 h-4" /> ATT&CK techniques
              </h2>
              <div className="flex flex-wrap gap-2">
                {results.techniques.map((t) => (
                  <Link
                    key={t.id}
                    to={`/rules?technique=${t.id}`}
                    title={t.rules ? `Rules mapped to ${t.id}` : `No rule is mapped to ${t.id}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-card text-sm hover:border-primary/40"
                  >
                    <span className="font-mono text-xs text-muted-foreground">{t.id}</span>
                    <Highlight text={t.name} terms={terms} />
                    <span className={`text-xs tabular-nums ${t.rules ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {t.rules} rule{t.rules === 1 ? '' : 's'}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <ResultSection title="Detection Rules" results={results.rules} total={results.totals.rules} terms={terms} more={terms.length === 1 ? `/rules?q=${encodeURIComponent(q)}` : undefined} />
          <ResultSection title="Pages" results={results.pages} total={results.totals.pages} terms={terms} />
          <ResultSection title="SPL Commands" results={results.splCommands} total={results.totals.splCommands} terms={terms} />
        </>
      )}
    </div>
  );
}
