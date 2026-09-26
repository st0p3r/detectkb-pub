import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileDown, Loader2, Tag, Trash2, X } from 'lucide-react';
import { apiErrorMessage, bulkDeleteRules, bulkUpdateRules, downloadSigmaRules, type RuleBulkAction, type RuleBulkTarget } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';

const STATUSES = ['draft', 'testing', 'production', 'deprecated'];
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

interface RuleBulkBarProps {
  count: number;
  target: RuleBulkTarget;
  canUpdate: boolean;
  canDelete: boolean;
  /** Offered when the whole page is selected but more rules match */
  selectAll?: { total: number; onSelect: () => void };
  onClear: () => void;
  /** After a change: refetch and clear the selection */
  onDone: () => void;
}

const btn =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/50 outline-none';

/** Floating bar with actions for the selected rules. */
export function RuleBulkBar({ count, target, canUpdate, canDelete, selectAll, onClear, onDone }: RuleBulkBarProps) {
  const { toast } = useToast();
  const [menu, setMenu] = useState<'status' | 'severity' | 'tag' | 'export' | null>(null);
  const [tagName, setTagName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const noun = `${count.toLocaleString()} rule${count === 1 ? '' : 's'}`;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  async function run(action: RuleBulkAction, value: string, describe: (changed: number) => string) {
    setMenu(null);
    setBusy(true);
    try {
      const { changed } = await bulkUpdateRules(target, action, value);
      toast(describe(changed), 'success');
      setTagName('');
      onDone();
    } catch (err) {
      toast(apiErrorMessage(err, 'Bulk update failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function exportSigma(skeletons: boolean) {
    setMenu(null);
    setBusy(true);
    try {
      const n = await downloadSigmaRules({ skeletons, ...('ids' in target ? { ids: target.ids } : { filter: target.filter }) });
      toast(
        n ? `Exported ${n} rule${n === 1 ? '' : 's'} as Sigma` : 'None of these rules has a Sigma source — export them as skeletons',
        n ? 'success' : 'info',
      );
    } catch (err) {
      toast(apiErrorMessage(err, 'Export failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setConfirmDelete(false);
    setBusy(true);
    try {
      const { deleted } = await bulkDeleteRules(target);
      toast(`Deleted ${deleted} rule${deleted === 1 ? '' : 's'}`, 'success');
      onDone();
    } catch (err) {
      toast(apiErrorMessage(err, 'Delete failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const menuBox = 'absolute bottom-full mb-2 left-0 z-30 min-w-[11rem] rounded-md border border-border bg-card shadow-lg py-1 text-sm';

  return (
    <>
      <div className="sticky bottom-4 z-20 mt-4 flex justify-center pointer-events-none">
        <div
          ref={barRef}
          role="toolbar"
          aria-label="Bulk actions"
          className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card/95 backdrop-blur px-3 py-2 shadow-xl animate-fade-in-up"
        >
          <span className="text-sm font-semibold px-1 tabular-nums">{noun} selected</span>
          {selectAll && (
            <button onClick={selectAll.onSelect} className="text-xs text-primary hover:underline px-1">
              Select all {selectAll.total.toLocaleString()} matching
            </button>
          )}
          <span className="w-px h-5 bg-border mx-1" />

          {canUpdate && (
            <>
              <div className="relative">
                <button
                  className={btn}
                  disabled={busy}
                  onClick={() => setMenu(menu === 'status' ? null : 'status')}
                  aria-haspopup="menu"
                  aria-expanded={menu === 'status'}
                >
                  Status <ChevronDown className="w-3 h-3" />
                </button>
                {menu === 'status' && (
                  <div role="menu" className={menuBox}>
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        role="menuitem"
                        className="w-full text-left px-3 py-1.5 hover:bg-accent"
                        onClick={() => run('status', s, (n) => `${n} rule${n === 1 ? '' : 's'} moved to ${s}`)}
                      >
                        <StatusBadge status={s} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  className={btn}
                  disabled={busy}
                  onClick={() => setMenu(menu === 'severity' ? null : 'severity')}
                  aria-haspopup="menu"
                  aria-expanded={menu === 'severity'}
                >
                  Severity <ChevronDown className="w-3 h-3" />
                </button>
                {menu === 'severity' && (
                  <div role="menu" className={menuBox}>
                    {SEVERITIES.map((s) => (
                      <button
                        key={s}
                        role="menuitem"
                        className="w-full text-left px-3 py-1.5 hover:bg-accent"
                        onClick={() => run('severity', s, (n) => `${n} rule${n === 1 ? '' : 's'} set to ${s}`)}
                      >
                        <SeverityBadge severity={s} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  className={btn}
                  disabled={busy}
                  onClick={() => setMenu(menu === 'tag' ? null : 'tag')}
                  aria-haspopup="dialog"
                  aria-expanded={menu === 'tag'}
                >
                  <Tag className="w-3.5 h-3.5" /> Tag
                </button>
                {menu === 'tag' && (
                  <form
                    className={`${menuBox} p-2 w-64 space-y-2`}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (tagName.trim()) run('addTag', tagName, (n) => `Tagged ${n} rule${n === 1 ? '' : 's'} #${tagName.trim()}`);
                    }}
                  >
                    <input
                      autoFocus
                      value={tagName}
                      onChange={(e) => setTagName(e.target.value)}
                      maxLength={80}
                      placeholder="Tag name"
                      aria-label="Tag name"
                      className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={!tagName.trim()}
                        className="flex-1 px-2 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                      >
                        Add tag
                      </button>
                      <button
                        type="button"
                        disabled={!tagName.trim()}
                        onClick={() => run('removeTag', tagName, (n) => `Removed #${tagName.trim()} from ${n} rule${n === 1 ? '' : 's'}`)}
                        className="flex-1 px-2 py-1.5 rounded border border-border text-xs font-medium hover:bg-accent disabled:opacity-50"
                      >
                        Remove tag
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}

          <div className="relative">
            <button
              className={btn}
              disabled={busy}
              onClick={() => setMenu(menu === 'export' ? null : 'export')}
              aria-haspopup="menu"
              aria-expanded={menu === 'export'}
            >
              <FileDown className="w-3.5 h-3.5" /> Export Sigma
            </button>
            {menu === 'export' && (
              <div role="menu" className={`${menuBox} w-60`}>
                <button role="menuitem" onClick={() => exportSigma(false)} className="w-full text-left px-3 py-2 hover:bg-accent">
                  Those with a Sigma source
                </button>
                <button role="menuitem" onClick={() => exportSigma(true)} className="w-full text-left px-3 py-2 hover:bg-accent">
                  All selected
                  <span className="block text-xs text-muted-foreground">Others as skeletons to complete</span>
                </button>
              </div>
            )}
          </div>

          {canDelete && (
            <button className={`${btn} text-destructive hover:bg-destructive/10`} disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}

          {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-1" aria-label="Working" />}
          <button
            onClick={onClear}
            aria-label="Clear selection"
            title="Clear selection (Esc)"
            className="p-1.5 rounded-md hover:bg-accent ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Outside the bar: it is pointer-events-none around the toolbar */}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${noun}?`}
        message={`This deletes the rule pages, their queries, links and history. It can't be undone — take a backup first if unsure.`}
        confirmLabel={`Delete ${noun}`}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
