import { afterEach, describe, expect, it, vi } from 'vitest';
import { WARM_DELAY_MS, WARM_IF_USED_WITHIN_MS, kbCache, kbCacheMap, markDataChanged, onDataChanged } from '../src/lib/kb-cache';

afterEach(() => vi.useRealTimers());

describe('kbCache', () => {
  it('builds once for concurrent and repeated calls', async () => {
    const build = vi.fn(async () => ({ n: 1 }));
    const c = kbCache(build);
    const [a, b] = await Promise.all([c.get(), c.get()]);
    await c.get();
    expect(build).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('rebuilds after data changes', async () => {
    let n = 0;
    const c = kbCache(async () => ++n);
    expect(await c.get()).toBe(1);
    markDataChanged();
    expect(c.isFresh()).toBe(false);
    expect(await c.get()).toBe(2);
    expect(await c.get()).toBe(2);
  });

  it('does not keep a build that started before a change', async () => {
    let release!: () => void;
    let n = 0;
    const c = kbCache(async () => {
      const mine = ++n;
      if (mine === 1) await new Promise<void>((r) => (release = r));
      return mine;
    });
    const first = c.get();
    markDataChanged(); // a write lands while the first build is running
    release();
    expect(await first).toBe(1);
    expect(await c.get()).toBe(2);
  });

  it('retries after a failed build', async () => {
    let fail = true;
    const c = kbCache(async () => {
      if (fail) throw new Error('db down');
      return 'ok';
    });
    await expect(c.get()).rejects.toThrow('db down');
    fail = false;
    expect(await c.get()).toBe('ok');
  });

  it('expires after maxAge (changes made outside the API)', async () => {
    vi.useFakeTimers();
    let n = 0;
    const c = kbCache(async () => ++n, 1000);
    expect(await c.get()).toBe(1);
    vi.advanceTimersByTime(999);
    expect(await c.get()).toBe(1);
    vi.advanceTimersByTime(2);
    expect(await c.get()).toBe(2);
  });

  it('notifies listeners of changes', () => {
    const fn = vi.fn();
    const off = onDataChanged(fn);
    markDataChanged();
    off();
    markDataChanged();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rebuilds a used warm cache in the background once writes settle', async () => {
    vi.useFakeTimers();
    let n = 0;
    const c = kbCache(async () => ++n, 60 * 60_000, { warm: true });
    expect(await c.get()).toBe(1);
    markDataChanged();
    markDataChanged(); // several writes: one rebuild
    expect(n).toBe(1);
    await vi.advanceTimersByTimeAsync(WARM_DELAY_MS + 10);
    expect(n).toBe(2);
    expect(c.isFresh()).toBe(true);
    expect(await c.get()).toBe(2);
  });

  it('does not rebuild a warm cache nobody used recently', async () => {
    vi.useFakeTimers();
    let n = 0;
    const c = kbCache(async () => ++n, 24 * 60 * 60_000, { warm: true });
    await c.get();
    vi.advanceTimersByTime(WARM_IF_USED_WITHIN_MS + 1);
    markDataChanged();
    await vi.advanceTimersByTimeAsync(WARM_DELAY_MS + 10);
    expect(n).toBe(1);
  });
});

describe('kbCacheMap', () => {
  it('caches per key and drops the oldest key past maxKeys', async () => {
    const build = vi.fn(async (k: string) => `v:${k}`);
    const m = kbCacheMap(build, { maxKeys: 2 });
    expect(await m.get('a')).toBe('v:a');
    await m.get('a');
    await m.get('b');
    expect(build).toHaveBeenCalledTimes(2);
    await m.get('c'); // drops a
    await m.get('a');
    expect(build).toHaveBeenCalledTimes(4);
    markDataChanged();
    await m.get('a');
    expect(build).toHaveBeenCalledTimes(5);
  });
});

