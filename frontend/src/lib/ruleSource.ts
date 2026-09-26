import { SOURCE_FORMAT_LABELS, type RuleSourceFormat } from '@/lib/api';

/** Colour of each rule source, shared by the rules table, dashboard and filters. */
export const SOURCE_STYLES: Record<RuleSourceFormat | 'manual', { dot: string; badge: string }> = {
  sigma: { dot: 'bg-violet-500', badge: 'border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300' },
  escu: { dot: 'bg-lime-600', badge: 'border-lime-400 text-lime-700 dark:border-lime-700 dark:text-lime-300' },
  elastic: { dot: 'bg-teal-500', badge: 'border-teal-300 text-teal-700 dark:border-teal-700 dark:text-teal-300' },
  sentinel: { dot: 'bg-sky-500', badge: 'border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300' },
  manual: { dot: 'bg-slate-400', badge: 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300' },
};

export const sourceLabel = (source: string) =>
  source === 'manual' ? 'Written here' : SOURCE_FORMAT_LABELS[source as RuleSourceFormat] ?? source;
