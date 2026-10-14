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

export interface KbCacheOptions {
  /**
   * Rebuild in the background once writes settle after a change, so the next
   * view doesn't wait for it — only while the value was used recently.
   */
  warm?: boolean;
}

// Background rebuilds after a change: a few seconds after the last write (an
// import makes hundreds), one cache at a time so they don't compete with
// requests for the database.
export const WARM_DELAY_MS = 3_000;
export const WARM_IF_USED_WITHIN_MS = 30 * 60_000;
interface Warmable {
  label: string;
  /** Stale, and used recently enough to be worth rebuilding */
  wanted(): boolean;
  rebuild(): Promise<unknown>;
}
const warmable: Warmable[] = [];
let warmTimer: NodeJS.Timeout | null = null;
let warming = false;

function scheduleWarm() {
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    warmTimer = null;
    void warmAll();
  }, WARM_DELAY_MS);
  warmTimer.unref();
}

async function warmAll() {
  // A round is still running: try again once it is done
  if (warming) return scheduleWarm();
  warming = true;
  try {
    const start = version;
    for (const w of warmable) {
      // A newer change re-arms the timer; leave the rest to that round
      if (version !== start) break;
      if (!w.wanted()) continue;
      await w.rebuild().catch((err) => console.error(`[cache] rebuilding ${w.label} failed:`, err));
    }
  } finally {
    warming = false;
  }
}

onDataChanged(() => {
  if (warmable.length) scheduleWarm();
});

/**
 * A value built from the knowledge base. Concurrent get() calls share one
 * build; a build that started before a change is not reused after it.
 */
export function kbCache<T>(build: () => Promise<T>, maxAgeMs = 10 * 60_000, opts: KbCacheOptions & { label?: string } = {}): KbCache<T> & { lastUsed(): number; rebuild(): Promise<T> } {
  let entry: { version: number; at: number; value: Promise<T> } | null = null;
  let lastUsed = 0;
  const isFresh = () => !!entry && entry.version === version && Date.now() - entry.at < maxAgeMs;
  const fill = () => {
    if (entry && isFresh()) return entry.value;
    const e = { version, at: Date.now(), value: build() };
    entry = e;
    // A failed build must not stick
    e.value.catch(() => {
      if (entry === e) entry = null;
    });
    return e.value;
  };
  const recent = () => Date.now() - lastUsed <= WARM_IF_USED_WITHIN_MS;
  if (opts.warm) warmable.push({ label: opts.label ?? (build.name || 'cache'), wanted: () => !isFresh() && recent(), rebuild: fill });
  return {
    isFresh,
    get() {
      lastUsed = Date.now();
      return fill();
    },
    // Background rebuilds don't count as use
    lastUsed: () => lastUsed,
    rebuild: fill,
  };
}

/**
 * kbCache per key (e.g. per status filter). Keys are expected to be few;
 * past `maxKeys` the oldest key is dropped.
 */
export function kbCacheMap<T>(build: (key: string) => Promise<T>, opts: KbCacheOptions & { maxAgeMs?: number; maxKeys?: number; label?: string } = {}) {
  const caches = new Map<string, ReturnType<typeof kbCache<T>>>();
  const stale = () =>
    Array.from(caches.values()).filter((c) => !c.isFresh() && Date.now() - c.lastUsed() <= WARM_IF_USED_WITHIN_MS);
  if (opts.warm) {
    warmable.push({
      label: opts.label ?? 'cache map',
      wanted: () => stale().length > 0,
      rebuild: async () => {
        for (const c of stale()) await c.rebuild();
      },
    });
  }
  return {
    get(key: string): Promise<T> {
      let c = caches.get(key);
      if (!c) {
        if (caches.size >= (opts.maxKeys ?? 20)) caches.delete(caches.keys().next().value!);
        c = kbCache(() => build(key), opts.maxAgeMs);
        caches.set(key, c);
      }
      return c.get();
    },
  };
}
