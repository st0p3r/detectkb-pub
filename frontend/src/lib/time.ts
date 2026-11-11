export function relativeTime(date: string | Date): string {
  const now = Date.now();
  const d = new Date(date).getTime();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(date).toLocaleDateString();
}

/** "in 12 days", "today", "5 days ago" — for dates that matter by the day (review dates). */
export function relativeDay(iso: string, now = new Date()): string {
  const days = Math.round((new Date(iso).getTime() - now.getTime()) / 86400000);
  if (days === 0) return 'today';
  const n = Math.abs(days);
  const span = n >= 60 ? `${Math.round(n / 30)} months` : `${n} day${n === 1 ? '' : 's'}`;
  return days > 0 ? `in ${span}` : `${span} ago`;
}
