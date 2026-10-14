import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Star, X } from 'lucide-react';
import { apiErrorMessage, getWatchlist, unwatchGroup, watchGroup, type WatchTechnique } from '@/lib/api';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const STATE: Record<WatchTechnique['state'], { label: string; chip: string; hint: string }> = {
  none: { label: 'Gap', chip: 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300', hint: 'No deployed rule detects it' },
  parent: {
    label: 'Parent only',
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    hint: 'Only deployed rules on the parent technique',
  },
  covered: { label: 'Covered', chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', hint: 'A production or testing rule detects it' },
};

const LIST_STEP = 40;

function useWatchMutations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['watchlist'] });
    qc.invalidateQueries({ queryKey: ['threat-groups'] });
    qc.invalidateQueries({ queryKey: ['threat-group'] });
    qc.invalidateQueries({ queryKey: ['attack-actor', 'watchlist'] });
  };
  const watch = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => watchGroup(id, note),
    onSuccess: refresh,
    onError: (err) => toast(apiErrorMessage(err, 'Could not update the watchlist'), 'error'),
  });
  const unwatch = useMutation({
    mutationFn: unwatchGroup,
    onSuccess: refresh,
    onError: (err) => toast(apiErrorMessage(err, 'Could not update the watchlist'), 'error'),
  });
  return { watch, unwatch };
}

/** Star that adds a group to the watchlist or removes it. */
export function WatchStar({ id, watched, withLabel = false }: { id: string; watched: boolean; withLabel?: boolean }) {
  const { hasPermission } = useAuth();
  const { watch, unwatch } = useWatchMutations();
  const busy = watch.isPending || unwatch.isPending;
  if (!hasPermission('rules:update')) {
    return watched ? <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500 shrink-0" aria-label="On the watchlist" /> : null;
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-pressed={watched}
      title={watched ? 'On the watchlist — click to remove' : 'Add to the watchlist'}
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) (watched ? unwatch.mutate(id) : watch.mutate({ id }));
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        if (!busy) (watched ? unwatch.mutate(id) : watch.mutate({ id }));
      }}
      className={cn(
        'inline-flex items-center gap-1 shrink-0 cursor-pointer rounded',
        withLabel ? 'px-2 py-1 border border-border text-sm hover:bg-accent' : 'p-0.5 hover:bg-accent'
      )}
    >
      <Star className={cn('w-3.5 h-3.5', watched ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
      {withLabel && (watched ? 'Watching' : 'Watch')}
    </span>
  );
}

function NoteEditor({ id, note }: { id: string; note: string | null }) {
  const { watch } = useWatchMutations();
  const [value, setValue] = useState(note ?? '');
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-xs text-muted-foreground hover:text-foreground text-left">
        {note || 'Add a note (why it matters)…'}
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        watch.mutate({ id, note: value }, { onSuccess: () => setEditing(false) });
      }}
      className="flex gap-1"
    >
      <input
        autoFocus
        value={value}
        maxLength={500}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. targets energy companies in our region"
        className="flex-1 min-w-0 px-2 py-1 rounded border border-border bg-background text-xs"
      />
      <button type="submit" className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs">
        Save
      </button>
    </form>
  );
}

/**
 * The watched groups and what to work on for them: the techniques they use
 * that no deployed rule detects, and the drafts that would close those gaps.
 */
export function WatchlistView({ onGroup }: { onGroup: (id: string) => void }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('rules:update');
  const { unwatch } = useWatchMutations();
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [shownTech, setShownTech] = useState(LIST_STEP);
  const [shownDrafts, setShownDrafts] = useState(LIST_STEP);
  const { data, isLoading, error } = useQuery({ queryKey: ['watchlist'], queryFn: getWatchlist });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (error || !data) return <p className="text-sm text-destructive">{apiErrorMessage(error)}</p>;
  if (!data.groups.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground space-y-2">
        <Star className="w-6 h-6 mx-auto text-amber-500" />
        <p>No group on the watchlist yet.</p>
        <p>
          On the <b>Groups</b> tab, search for the sectors or countries you care about (tick <i>Search descriptions</i>, e.g. “energy”, “Middle
          East”, “financial”) and star the groups relevant to your organisation. Gaps and draft rules are then prioritized by the techniques
          those groups use.
        </p>
      </div>
    );
  }

  const name = new Map(data.groups.map((g) => [g.id, g.name]));
  const techniques = data.techniques.filter((t) => !onlyOpen || t.state !== 'covered');
  const s = data.summary;
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold mb-3">Watched groups ({data.groups.length})</h2>
        <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.groups.map((g) => (
            <li key={g.id} className="rounded-md border border-border p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <button onClick={() => onGroup(g.id)} className="font-medium text-primary hover:underline truncate">
                  {g.name}
                </button>
                <span className="font-mono text-[11px] text-muted-foreground">{g.id}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground" title="Techniques covered by production / testing rules">
                  {g.covered}/{g.total} · {g.pct}%
                </span>
                {canEdit && (
                  <button onClick={() => unwatch.mutate(g.id)} title="Remove from the watchlist" className="p-0.5 rounded hover:bg-accent text-muted-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <span className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                <span className="bg-emerald-500" style={{ width: `${(g.covered / Math.max(g.total, 1)) * 100}%` }} />
                <span className="bg-amber-400" style={{ width: `${(g.parentOnly / Math.max(g.total, 1)) * 100}%` }} />
              </span>
              {canEdit ? <NoteEditor id={g.id} note={g.note} /> : g.note && <p className="text-xs text-muted-foreground">{g.note}</p>}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          ['Techniques they use', s.techniques, ''],
          ['Covered', s.covered, 'text-emerald-600 dark:text-emerald-400'],
          ['Parent only', s.parentOnly, 'text-amber-600 dark:text-amber-400'],
          ['Gaps', s.gaps, 'text-red-600 dark:text-red-400'],
          ['Drafts closing gaps', s.draftsFillingGaps, 'text-primary'],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn('text-xl font-semibold tabular-nums', color as string)}>{value}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Coverage counts production and testing rules. {s.openWithoutDraft} open technique{s.openWithoutDraft === 1 ? ' has' : 's have'} no draft
        either: they need a new rule (see Upstream Updates and Atomic Red Team) or telemetry.
        {s.preCompromise > 0 &&
          ` ${s.preCompromise} more ${s.preCompromise === 1 ? 'is' : 'are'} pre-compromise (reconnaissance, resource development) and listed last: they happen outside your systems.`}
      </p>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="font-semibold">Draft rules to finish first</h2>
          <span className="text-xs text-muted-foreground">ranked by the watched groups whose gaps each would close</span>
        </div>
        {data.drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No draft rule covers a technique of these groups.</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {data.drafts.slice(0, shownDrafts).map((d) => (
                <li key={d.pageId} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                  <Link to={`/pages/${d.slug}`} className="text-primary hover:underline truncate max-w-[30rem]">
                    {d.title}
                  </Link>
                  <SeverityBadge severity={d.severity} />
                  {d.fills.length > 0 ? (
                    <span className="text-xs text-red-700 dark:text-red-300" title={d.groups.map((g) => name.get(g) ?? g).join(', ')}>
                      closes {d.fills.join(', ')} for {d.groups.length} group{d.groups.length === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">adds depth to {d.depth.join(', ')}</span>
                  )}
                </li>
              ))}
            </ul>
            {data.drafts.length > shownDrafts && (
              <button onClick={() => setShownDrafts((n) => n + LIST_STEP)} className="mt-2 text-sm text-primary hover:underline">
                Show more ({data.drafts.length - shownDrafts} left)
              </button>
            )}
          </>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="font-semibold">Techniques of the watched groups</h2>
          <label className="flex items-center gap-1.5 text-xs ml-auto">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only gaps and parent-only
          </label>
        </div>
        <ul className="divide-y divide-border">
          {techniques.slice(0, shownTech).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
              <span className={cn('px-1.5 py-px rounded border text-[11px] font-medium', STATE[t.state].chip)} title={STATE[t.state].hint}>
                {STATE[t.state].label}
              </span>
              <Link to={`/graph?view=chain&technique=${t.id}`} className="font-mono text-xs text-primary hover:underline">
                {t.id}
              </Link>
              <span className="truncate max-w-[22rem]">{t.name}</span>
              {t.preCompromise && t.state !== 'covered' && (
                <span className="px-1.5 py-px rounded bg-muted text-[11px] text-muted-foreground" title="Reconnaissance / resource development: happens outside your systems">
                  pre-compromise
                </span>
              )}
              <span className="text-xs text-muted-foreground truncate max-w-[24rem]" title={t.groups.map((g) => name.get(g) ?? g).join(', ')}>
                used by {t.groups.map((g) => name.get(g) ?? g).join(', ')}
              </span>
              <span className="ml-auto flex gap-3 text-xs text-muted-foreground tabular-nums">
                {t.deployedRules > 0 && <span>{t.deployedRules} deployed</span>}
                {t.draftRules > 0 && (
                  <Link to={`/rules?technique=${t.id}&status=draft`} className="text-primary hover:underline">
                    {t.draftRules} draft{t.draftRules === 1 ? '' : 's'}
                  </Link>
                )}
                <Link to={`/atomic-tests?technique=${t.id}`} className="hover:text-primary">
                  tests
                </Link>
              </span>
            </li>
          ))}
        </ul>
        {techniques.length > shownTech && (
          <button onClick={() => setShownTech((n) => n + LIST_STEP)} className="mt-2 text-sm text-primary hover:underline">
            Show more ({techniques.length - shownTech} left)
          </button>
        )}
      </section>
    </div>
  );
}
