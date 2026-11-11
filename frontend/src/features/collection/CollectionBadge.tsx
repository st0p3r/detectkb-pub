import { CheckCircle2, CircleDashed, CircleOff } from 'lucide-react';
import type { CollectionState, RuleFeed } from '@/lib/api';
import { cn } from '@/lib/utils';

const STATE: Record<CollectionState, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  collected: { label: 'Collected', icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  'not-collected': { label: 'Not collected', icon: CircleOff, cls: 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/30' },
  unknown: { label: 'Not decided', icon: CircleDashed, cls: 'text-muted-foreground bg-muted/50 border-border' },
};

/** Whether a log source or event is collected. */
export function CollectionBadge({ state, inherited, className }: { state: CollectionState; inherited?: boolean; className?: string }) {
  const s = STATE[state];
  const Icon = s.icon;
  return (
    <span
      className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap', s.cls, className)}
      title={inherited ? 'From its log source' : undefined}
    >
      <Icon className="w-3 h-3" /> {s.label}
    </span>
  );
}

const FEED: Record<RuleFeed, { label: string; hint: string; state: CollectionState }> = {
  fed: { label: 'Logs collected', hint: 'The telemetry this rule reads is collected', state: 'collected' },
  blind: { label: 'No logs', hint: 'The telemetry this rule reads is not collected: it cannot fire', state: 'not-collected' },
  unknown: { label: 'Logs not decided', hint: 'Nobody said yet whether the telemetry this rule reads is collected', state: 'unknown' },
};

/** Whether a rule's logs are collected. */
export function FeedBadge({ feed, className }: { feed: RuleFeed; className?: string }) {
  const f = FEED[feed];
  const s = STATE[f.state];
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap', s.cls, className)} title={f.hint}>
      <Icon className="w-3 h-3" /> {f.label}
    </span>
  );
}
