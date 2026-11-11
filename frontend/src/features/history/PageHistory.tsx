import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { History, Loader2, RotateCcw, X } from 'lucide-react';
import { apiErrorMessage, getPageRevision, listPageRevisions, restorePageRevision, type Page, type RevisionDetail, type RevisionRule } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { lineDiff, withContext } from '@/lib/lineDiff';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const PART_LABELS: Record<string, string> = {
  title: 'Title',
  content: 'Text',
  status: 'Status',
  severity: 'Severity',
  splQuery: 'SPL query',
  nativeQuery: 'Query',
  nativeLanguage: 'Query language',
  sigmaYaml: 'Sigma rule',
  mitreTactics: 'Tactics',
  mitreTechniques: 'Techniques',
  dataSource: 'Data source',
  falsePositives: 'False positives',
  references: 'References',
  testNotes: 'Test notes',
  triage: 'Triage steps',
  response: 'Response steps',
};

function Diff({ before, after }: { before: string; after: string }) {
  const lines = withContext(lineDiff(before, after));
  if (!lines.length) return <p className="text-xs text-muted-foreground">No change.</p>;
  return (
    <pre dir="auto" className="rounded-md border border-border bg-muted/30 text-xs leading-5 overflow-x-auto max-h-80">
      {lines.map((l, i) =>
        l === null ? (
          <div key={i} className="px-3 text-muted-foreground select-none">
            ⋯
          </div>
        ) : (
          <div
            key={i}
            className={cn(
              'px-3 whitespace-pre-wrap break-words',
              l.kind === 'add' && 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-200',
              l.kind === 'del' && 'bg-red-500/15 text-red-900 dark:text-red-200 line-through decoration-red-500/40'
            )}
          >
            <span className="select-none opacity-60 mr-2">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
            {l.text || ' '}
          </div>
        )
      )}
    </pre>
  );
}

/** What a version changed compared with the one before it. */
function Changes({ rev }: { rev: RevisionDetail }) {
  const prev = rev.previous;
  if (!prev) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">The first version in the history. Its text:</p>
        <pre dir="auto" className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-5 whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
          {rev.contentMd || '(empty)'}
        </pre>
      </div>
    );
  }
  const fields = Array.from(new Set([...Object.keys(rev.rule ?? {}), ...Object.keys(prev.rule ?? {})])) as (keyof RevisionRule)[];
  const changedFields = fields.filter((f) => (rev.rule?.[f] ?? '') !== (prev.rule?.[f] ?? ''));
  const nothing = rev.title === prev.title && rev.contentMd === prev.contentMd && !changedFields.length;
  return (
    <div className="space-y-4">
      {nothing && <p className="text-sm text-muted-foreground">Nothing changed in the text or the rule.</p>}
      {rev.title !== prev.title && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Title</h4>
          <Diff before={prev.title} after={rev.title} />
        </section>
      )}
      {rev.contentMd !== prev.contentMd && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Text</h4>
          <Diff before={prev.contentMd} after={rev.contentMd} />
        </section>
      )}
      {changedFields.map((f) => (
        <section key={f}>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{PART_LABELS[f] ?? f}</h4>
          <Diff before={prev.rule?.[f] ?? ''} after={rev.rule?.[f] ?? ''} />
        </section>
      ))}
    </div>
  );
}

/** A page's versions: who changed what and when, with a way back to any of them. */
export function PageHistory({ page, onClose, onRestored }: { page: Page; onClose: () => void; onRestored: (page: Page) => void }) {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const { data: revisions, isLoading, error } = useQuery({ queryKey: ['page-revisions', page.id, page.updatedAt], queryFn: () => listPageRevisions(page.id) });
  const [selected, setSelected] = useState<number | null>(null);
  const current = selected ?? revisions?.[0]?.id ?? null;
  const { data: detail } = useQuery({ queryKey: ['page-revision', page.id, current], queryFn: () => getPageRevision(page.id, current!), enabled: current !== null });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const summary = revisions?.find((r) => r.id === current);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !confirm && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, confirm]);

  async function restore() {
    if (current === null) return;
    setConfirm(false);
    setBusy(true);
    try {
      const restored = await restorePageRevision(page.id, current);
      toast('That version is the page again', 'success');
      onRestored(restored);
    } catch (err) {
      toast(apiErrorMessage(err, 'Could not restore that version'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // On <body>: the page area is animated with a transform, which would trap a fixed overlay inside it
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Page history" onClick={(e) => e.stopPropagation()} className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <History className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold">History</h2>
          <span dir="auto" className="text-sm text-muted-foreground truncate">{page.title}</span>
          <button onClick={onClose} aria-label="Close history" className="ml-auto p-1 rounded hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <p className="flex items-center gap-2 p-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </p>
        ) : error ? (
          <p className="p-8 text-center text-sm text-destructive">{apiErrorMessage(error, 'Could not load the history')}</p>
        ) : !revisions?.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No history yet. From now on every saved change to this page is kept here, and any earlier version can be brought back.
          </p>
        ) : (
          <div className="grid md:grid-cols-[17rem_1fr] min-h-0 flex-1">
            <ul className="overflow-y-auto border-b md:border-b-0 md:border-r border-border max-h-48 md:max-h-none">
              {revisions.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelected(r.id)}
                    aria-current={r.id === current}
                    className={cn('w-full text-left px-4 py-2.5 border-b border-border/60 hover:bg-accent/50', r.id === current && 'bg-primary/10')}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium" title={new Date(r.createdAt).toLocaleString()}>
                        {relativeTime(r.createdAt)}
                      </span>
                      {r.current && <span className="px-1.5 py-px rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">current</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{r.author ?? 'before history started'}</div>
                    {r.changed.length > 0 && (
                      <div className="mt-1 text-[11px] text-muted-foreground truncate" title={r.changed.map((c) => PART_LABELS[c] ?? c).join(', ')}>
                        {r.changed.map((c) => PART_LABELS[c] ?? c).join(', ')}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <div className="overflow-y-auto p-4 min-w-0">
              {!detail || !summary ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="text-sm">
                      <span className="font-medium">{new Date(detail.createdAt).toLocaleString()}</span>
                      <span className="text-muted-foreground"> · {detail.author ?? 'before history started'}</span>
                    </div>
                    {!summary.current && hasPermission('pages:update') && (
                      <button
                        onClick={() => setConfirm(true)}
                        disabled={busy}
                        className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Restore this version
                      </button>
                    )}
                  </div>
                  <Changes rev={detail} />
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmDialog
          open={confirm}
          title="Restore this version?"
          message="The page (and, for a rule, its queries and notes) goes back to this version. The version of today stays in the history, so this can be undone."
          confirmLabel="Restore"
          onConfirm={restore}
          onCancel={() => setConfirm(false)}
        />
      </div>
    </div>,
    document.body
  );
}
