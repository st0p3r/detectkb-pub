import { useMutation } from '@tanstack/react-query';
import { apiErrorMessage, setCollection, type CollectionState } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { CollectionBadge } from './CollectionBadge';
import { useCollection, useInvalidateCollection } from './useCollection';

const OPTIONS: { state: CollectionState; label: string; value: boolean | null; on: string }[] = [
  { state: 'collected', label: 'Collected', value: true, on: 'bg-emerald-600 text-white' },
  { state: 'not-collected', label: 'Not collected', value: false, on: 'bg-red-600 text-white' },
  { state: 'unknown', label: 'Not decided', value: null, on: 'bg-muted text-foreground' },
];

const FIELD_LABELS: Record<CollectionState, string> = { collected: 'We have it', 'not-collected': 'Missing', unknown: 'Not decided' };

/**
 * Says whether a log source ("sysmon") or one event ("sysmon:10") is
 * collected. For an event, "as its source" removes its own answer.
 * People who can't edit rules see the answer only.
 */
export function CollectionControl({ telemetryKey, compact, stopPropagation }: { telemetryKey: string; compact?: boolean; stopPropagation?: boolean }) {
  // A field ("field:commandline") is there or missing; it has no source to follow
  const isField = telemetryKey.startsWith('field:');
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const collection = useCollection();
  const invalidate = useInvalidateCollection();
  const isEvent = telemetryKey.includes(':') && !isField;
  const own = collection.own(telemetryKey);
  const applied = collection.stateOf(telemetryKey);
  const save = useMutation({
    mutationFn: (collected: boolean | null) => setCollection([{ key: telemetryKey, collected }]),
    onSuccess: invalidate,
    onError: (err) => toast(apiErrorMessage(err, 'Could not save'), 'error'),
  });

  if (!hasPermission('rules:update')) return <CollectionBadge state={applied} inherited={isEvent && own === 'unknown' && applied !== 'unknown'} />;

  return (
    <div
      className={cn('inline-flex rounded-md border border-border overflow-hidden', save.isPending && 'opacity-60')}
      role="group"
      aria-label={isField ? 'Is this field in your events?' : 'Is this collected?'}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {OPTIONS.map((o) => {
        // An event without its own answer shows its source's, dimmed
        const active = own === o.state;
        const inherited = isEvent && own === 'unknown' && o.state !== 'unknown' && applied === o.state;
        const label = o.state === 'unknown' && isEvent ? 'As its source' : isField ? FIELD_LABELS[o.state] : o.label;
        return (
          <button
            key={o.state}
            disabled={save.isPending}
            onClick={() => !active && save.mutate(o.value)}
            aria-pressed={active}
            title={inherited ? `${o.label} — from its log source` : undefined}
            className={cn(
              compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
              'font-medium border-l border-border first:border-l-0 transition-colors',
              active ? o.on : inherited ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-accent'
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
