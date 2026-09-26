import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { SOURCE_FORMAT_LABELS, type ImportPreviewItem } from '@/lib/api';
import { SourceBadge } from '@/components/ui/SourceBadge';
import { cn } from '@/lib/utils';

type Tab = ImportPreviewItem['status'];

const TABS: { id: Tab; label: string; tone: string; hint: string }[] = [
  { id: 'new', label: 'New', tone: 'text-emerald-600 dark:text-emerald-400', hint: 'Not in DetectKB yet' },
  { id: 'changed', label: 'Changed', tone: 'text-blue-600 dark:text-blue-400', hint: 'Imported before; the source has changed since' },
  { id: 'unchanged', label: 'Unchanged', tone: 'text-muted-foreground', hint: 'Imported before and identical — skipped' },
  { id: 'repeated', label: 'Repeated', tone: 'text-muted-foreground', hint: 'The same rule appears earlier in this upload — skipped' },
  { id: 'error', label: 'Errors', tone: 'text-destructive', hint: "Couldn't be read — skipped" },
];
const LIST_STEP = 100;

interface ImportReviewProps {
  items: ImportPreviewItem[];
  /** Entries (by `where`) the user unticked */
  excluded: Set<string>;
  onExcludedChange: (next: Set<string>) => void;
  updateChanged: boolean;
  onUpdateChangedChange: (v: boolean) => void;
  onNavigate: () => void;
}

/** The import preview: what's new, what changed (field by field), what would be skipped. */
export function ImportReview({ items, excluded, onExcludedChange, updateChanged, onUpdateChangedChange, onNavigate }: ImportReviewProps) {
  const byStatus = (s: Tab) => items.filter((i) => i.status === s);
  const [tab, setTab] = useState<Tab>(() => (byStatus('new').length ? 'new' : byStatus('changed').length ? 'changed' : 'unchanged'));
  const [shown, setShown] = useState(LIST_STEP);
  const [open, setOpen] = useState<string | null>(null);
  const list = byStatus(tab);
  const selectable = tab === 'new' || tab === 'changed';
  const similarCount = byStatus('new').filter((i) => i.similar?.length).length;

  const toggle = (where: string) => {
    const next = new Set(excluded);
    if (next.has(where)) next.delete(where);
    else next.add(where);
    onExcludedChange(next);
  };
  const setAll = (include: boolean, only?: (i: ImportPreviewItem) => boolean) => {
    const next = new Set(excluded);
    for (const i of list.filter(only ?? (() => true))) {
      if (include) next.delete(i.where);
      else next.add(i.where);
    }
    onExcludedChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => {
          const n = byStatus(t.id).length;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              title={t.hint}
              disabled={!n}
              onClick={() => {
                setTab(t.id);
                setShown(LIST_STEP);
              }}
              className={cn(
                'px-3 py-1.5 rounded-md border text-sm disabled:opacity-40',
                tab === t.id ? 'border-primary bg-primary/10 font-medium' : 'border-border hover:bg-accent'
              )}
            >
              <span className={t.tone}>{t.label}</span> <span className="tabular-nums">{n.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{TABS.find((t) => t.id === tab)!.hint}.</p>

      {tab === 'changed' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={updateChanged} onChange={(e) => onUpdateChangedChange(e.target.checked)} />
          Update changed rules — their status here, test notes and tags are kept
        </label>
      )}
      {tab === 'new' && similarCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          {similarCount} new rule{similarCount === 1 ? ' has' : 's have'} the same title as an existing rule — possibly the same detection from another
          source.
          <button onClick={() => setAll(false, (i) => !!i.similar?.length)} className="text-primary hover:underline">
            Leave those out
          </button>
        </div>
      )}
      {selectable && list.length > 0 && (
        <div className="flex gap-3 text-xs">
          <button onClick={() => setAll(true)} className="text-primary hover:underline">
            Select all
          </button>
          <button onClick={() => setAll(false)} className="text-muted-foreground hover:text-foreground">
            None
          </button>
        </div>
      )}

      <ul className={cn('max-h-[45vh] overflow-y-auto rounded-md border border-border divide-y divide-border', tab === 'changed' && !updateChanged && 'opacity-50')}>
        {list.slice(0, shown).map((i) => (
          <li key={i.where} className="px-3 py-2 text-sm">
            <div className="flex items-start gap-2">
              {selectable && (
                <input
                  type="checkbox"
                  checked={!excluded.has(i.where)}
                  onChange={() => toggle(i.where)}
                  disabled={tab === 'changed' && !updateChanged}
                  aria-label={`Include ${i.title}`}
                  className="mt-0.5"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {tab === 'changed' ? (
                    <button onClick={() => setOpen(open === i.where ? null : i.where)} className="inline-flex items-center gap-1 font-medium text-left hover:text-primary">
                      {open === i.where ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      {i.title}
                    </button>
                  ) : (
                    <span className="font-medium">{i.title ?? i.where}</span>
                  )}
                  {i.format && <SourceBadge source={i.format} />}
                  {i.changes?.map((c) => (
                    <span key={c.field} className="px-1.5 py-px rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[11px]">
                      {c.label}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {i.where}
                  {i.error && <span className={tab === 'error' ? 'text-destructive' : ''}> — {i.error}</span>}
                  {i.existing && (
                    <>
                      {' '}
                      · now:{' '}
                      <Link to={`/pages/${i.existing.slug}`} onClick={onNavigate} className="text-primary hover:underline">
                        {i.existing.title}
                      </Link>{' '}
                      ({i.existing.status})
                    </>
                  )}
                </div>
                {i.similar?.length ? (
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    Same title as{' '}
                    {i.similar.map((s, n) => (
                      <React.Fragment key={s.slug}>
                        {n > 0 && ', '}
                        <Link to={`/pages/${s.slug}`} onClick={onNavigate} className="underline">
                          {s.sourceFormat ? SOURCE_FORMAT_LABELS[s.sourceFormat] : 'a rule written here'}
                        </Link>
                      </React.Fragment>
                    ))}
                  </div>
                ) : null}
                {open === i.where && i.changes && (
                  <div className="mt-2 space-y-2">
                    {i.changes.map((c) => (
                      <div key={c.field}>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">{c.label}</div>
                        <div className="grid sm:grid-cols-2 gap-1.5 text-xs font-mono">
                          <pre className="whitespace-pre-wrap break-words rounded bg-red-500/10 text-red-700 dark:text-red-300 px-2 py-1 max-h-40 overflow-auto">
                            {c.before || '(empty)'}
                          </pre>
                          <pre className="whitespace-pre-wrap break-words rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-1 max-h-40 overflow-auto">
                            {c.after || '(empty)'}
                          </pre>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
        {list.length > shown && (
          <li className="px-3 py-2">
            <button onClick={() => setShown((n) => n + LIST_STEP)} className="text-sm text-primary hover:underline">
              Show more ({(list.length - shown).toLocaleString()} left)
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
