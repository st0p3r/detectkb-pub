// Which automatic backups to keep. One is made every day; without a limit
// they fill the disk. Kept: the newest KEEP_DAILY, and beyond those one per
// week (the newest of each week) for KEEP_WEEKLY weeks. Backups made by hand
// are never removed automatically.

const num = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? Math.min(Math.max(Math.floor(n), min), max) : fallback;
};

export const KEEP_DAILY = num(process.env.BACKUP_KEEP_DAILY, 14, 1, 3650);
export const KEEP_WEEKLY = num(process.env.BACKUP_KEEP_WEEKLY, 8, 0, 520);

export const SCHEDULED = 'scheduled';

export interface BackupEntry {
  id: number;
  type: string;
  createdAt: Date;
}

/** Monday 00:00 UTC of the date's week, as a sortable key. */
const weekOf = (d: Date) => {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};

/** The automatic backups to remove under the policy. */
export function backupsToPrune<T extends BackupEntry>(backups: T[], keepDaily = KEEP_DAILY, keepWeekly = KEEP_WEEKLY): T[] {
  const scheduled = backups.filter((b) => b.type === SCHEDULED).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keep = new Set(scheduled.slice(0, keepDaily).map((b) => b.id));
  // Older ones: the newest of each week, for the next keepWeekly weeks
  const weeks = new Set<string>();
  for (const b of scheduled.slice(keepDaily)) {
    const week = weekOf(b.createdAt);
    if (weeks.has(week)) continue;
    if (weeks.size >= keepWeekly) break;
    weeks.add(week);
    keep.add(b.id);
  }
  return scheduled.filter((b) => !keep.has(b.id));
}

/** Backups older than `days`, whatever their kind, always leaving the newest `keepNewest`. */
export function backupsOlderThan<T extends BackupEntry>(backups: T[], days: number, now = new Date(), keepNewest = 3): T[] {
  const sorted = [...backups].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const cutoff = now.getTime() - days * 86400000;
  return sorted.slice(keepNewest).filter((b) => b.createdAt.getTime() < cutoff);
}
