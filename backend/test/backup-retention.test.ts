import { describe, expect, it } from 'vitest';
import { backupsOlderThan, backupsToPrune } from '../src/lib/backup-retention';

const day = (n: number) => new Date(Date.UTC(2026, 5, 30) - n * 86400000);
// One automatic backup a day for 120 days (id = how many days ago), plus two made by hand
const daily = Array.from({ length: 120 }, (_, n) => ({ id: n, type: 'scheduled', createdAt: day(n) }));
const manual = [
  { id: 1000, type: 'json', createdAt: day(100) },
  { id: 1001, type: 'json', createdAt: day(1) },
];

describe('backup retention', () => {
  it('keeps the newest daily backups and one a week before that', () => {
    const pruned = new Set(backupsToPrune([...daily, ...manual], 14, 8).map((b) => b.id));
    const kept = daily.filter((b) => !pruned.has(b.id)).map((b) => b.id);
    expect(kept.slice(0, 14)).toEqual(Array.from({ length: 14 }, (_, n) => n));
    expect(kept).toHaveLength(14 + 8);
    // The weekly ones: the newest of each earlier week, so a week apart after the first
    const weekly = kept.slice(14);
    for (let i = 2; i < weekly.length; i++) expect(weekly[i] - weekly[i - 1]).toBe(7);
    expect(weekly[1] - weekly[0]).toBeLessThanOrEqual(7);
    expect(Math.max(...kept)).toBeLessThan(14 + 9 * 7);
  });

  it('never removes backups made by hand', () => {
    const pruned = backupsToPrune([...daily, ...manual], 1, 0);
    expect(pruned.some((b) => b.type !== 'scheduled')).toBe(false);
    expect(pruned).toHaveLength(119);
  });

  it('removes nothing while there are few', () => {
    expect(backupsToPrune(daily.slice(0, 10), 14, 8)).toEqual([]);
  });

  it('cleans up by age but always leaves the newest ones', () => {
    const now = day(0);
    const old = backupsOlderThan([...daily, ...manual], 30, now).map((b) => b.id);
    expect(new Set(old)).toEqual(new Set([...Array.from({ length: 89 }, (_, n) => n + 31), 1000]));
    // Everything is old: the three newest stay
    expect(backupsOlderThan(daily.slice(50), 1, now)).toHaveLength(67);
  });
});
