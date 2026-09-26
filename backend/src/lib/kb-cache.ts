// Caches for data derived from the whole knowledge base (the knowledge graph,
// rule ↔ attacker-tool matches). They are expensive to build (~1 s with
// 2,000+ rules) and change only when data is written, so instead of a short
// timer they are kept until a write marks them stale (markDataChanged — called
// for every successful write request, see index.ts) or maxAge passes, as a
// backstop for changes made outside the API (e.g. directly in MySQL).

let version = 0;
const listeners = new Set<() => void>();

/** Something in the knowledge base changed: derived caches are stale. */
export function markDataChanged() {
  version++;
  for (const fn of listeners) fn();
}

/** Runs `fn` after data changes (used to rebuild a cache in the background). */
export function onDataChanged(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export interface KbCache<T> {
  get(): Promise<T>;
  /** True when get() would return without building. */
  isFresh(): boolean;
}

/**
 * A value built from the knowledge base. Concurrent get() calls share one
 * build; a build that started before a change is not reused after it.
 */
export function kbCache<T>(build: () => Promise<T>, maxAgeMs = 10 * 60_000): KbCache<T> {
  let entry: { version: number; at: number; value: Promise<T> } | null = null;
  const isFresh = () => !!entry && entry.version === version && Date.now() - entry.at < maxAgeMs;
  return {
    isFresh,
    get() {
      if (entry && isFresh()) return entry.value;
      const e = { version, at: Date.now(), value: build() };
      entry = e;
      // A failed build must not stick
      e.value.catch(() => {
        if (entry === e) entry = null;
      });
      return e.value;
    },
  };
}
