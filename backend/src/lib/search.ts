// Ranking for the global search: every word of the query has to appear in a
// result, a hit in the title counts for more than one in the text, and each
// result says where it matched.

export const MAX_TERMS = 6;

/** The words of a query, lower-cased (at most MAX_TERMS; duplicates dropped). */
export function searchTerms(q: string): string[] {
  return Array.from(new Set(q.toLowerCase().split(/\s+/).filter(Boolean))).slice(0, MAX_TERMS);
}

export interface SearchField {
  /** Shown to the user: "SPL query", "False positives", … */
  label: string;
  text: string | null | undefined;
  /** How much a hit here says about the result (title hits are scored separately) */
  weight: number;
  /** Not matched by a word that is only digits ("10" is not a hit in "T1003.001") */
  skipNumbers?: boolean;
}

export interface Scored {
  score: number;
  /** Where it matched: "Title" or a field's label */
  matchedIn: string;
  snippet: string;
}

const SNIPPET_BEFORE = 60;
const SNIPPET_LENGTH = 200;

/** A stretch of the text around the first of the terms found in it. */
export function snippetAround(text: string, terms: string[]): string {
  // Markdown marks say nothing in a one-line quote
  const flat = text
    .replace(/\*\*|`/g, '')
    .replace(/(^|\s)#{1,6}\s/g, '$1')
    .replace(/(^|\s)_(?=\S)|(?<=\S)_(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = flat.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
  const idx = at.length ? Math.min(...at) : 0;
  const start = Math.max(0, idx - SNIPPET_BEFORE);
  const piece = flat.slice(start, start + SNIPPET_LENGTH);
  return `${start > 0 ? '…' : ''}${piece}${start + SNIPPET_LENGTH < flat.length ? '…' : ''}`;
}

/**
 * Scores one candidate, or null when a word of the query is in neither its
 * title nor any field. `fallback` is the field to quote when only the title
 * matched (a page's text, a rule's query).
 */
export function scoreResult(title: string, fields: SearchField[], terms: string[], fallback?: string | null): Scored | null {
  if (!terms.length) return null;
  const lowTitle = title.toLowerCase();
  const full = terms.join(' ');
  const low = fields.map((f) => ({ ...f, low: (f.text ?? '').toLowerCase() }));

  let score = 0;
  let best: (typeof low)[number] | null = null;
  for (const term of terms) {
    const inTitle = lowTitle.includes(term);
    const numeric = /^\d+$/.test(term);
    const hits = low.filter((f) => !(numeric && f.skipNumbers) && f.low.includes(term));
    if (!inTitle && !hits.length) return null;
    if (inTitle) score += 10;
    const top = hits.reduce<(typeof low)[number] | null>((a, b) => (!a || b.weight > a.weight ? b : a), null);
    if (top) {
      score += top.weight;
      if (!best || top.weight > best.weight) best = top;
    }
  }
  // The whole query as typed, in the title
  if (lowTitle === full) score += 100;
  else if (lowTitle.startsWith(full)) score += 60;
  else if (lowTitle.includes(full)) score += 40;

  const titleOnly = terms.every((t) => lowTitle.includes(t));
  const quote = titleOnly ? null : best;
  return {
    score,
    matchedIn: quote ? quote.label : 'Title',
    snippet: quote?.text ? snippetAround(quote.text, terms) : fallback ? snippetAround(fallback, terms) : '',
  };
}

/** Best first; equal scores: the more recently changed one first. */
export function rank<T extends { score: number; updatedAt?: Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.score - a.score || (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
}
