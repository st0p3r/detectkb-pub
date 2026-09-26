import { afterEach, describe, expect, it, vi } from 'vitest';
import { kbCache, markDataChanged, onDataChanged } from '../src/lib/kb-cache';

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
});
