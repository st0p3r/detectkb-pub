import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, FolderUp, GitPullRequestArrow, Loader2, RefreshCw, Search } from 'lucide-react';
import {
  SOURCE_FORMAT_LABELS,
  apiErrorMessage,
  checkUpstreamSource,
  checkUpstreamUpload,
  dismissUpstreamItems,
  getUpstreamItemContent,
  getUpstreamSources,
  importUpstreamItems,
  listUpstreamItems,
  updateUpstreamSource,
  type UpstreamItem,
  type UpstreamSourceInfo,
} from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { useDebounced } from '@/hooks/useDebounced';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

type Kind = 'changed' | 'new';
const RULE_FILE = /\.(ya?ml|toml)$/i;

function SourceCard({ s, canCheck, canManage, onChanged }: { s: UpstreamSourceInfo; canCheck: boolean; canManage: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const check = useMutation({
    mutationFn: () => checkUpstreamSource(s.key),
    onSuccess: () => {
      toast(`Checking ${s.label}…`, 'info');
      onChanged();
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not start the check'), 'error'),
  });
  const update = useMutation({
    mutationFn: (body: { enabled?: boolean; option?: string }) => updateUpstreamSource(s.key, body),
    onSuccess: onChanged,
    onError: (err) => toast(apiErrorMessage(err, 'Could not save'), 'error'),
  });
  return (
    <div className={cn('rounded-lg border bg-card p-4 space-y-2', s.enabled ? 'border-border' : 'border-dashed border-border opacity-80')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="font-medium">{s.label}</div>
          {s.repository ? (
            <a href={s.repository} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              {s.repository.replace('https://github.com/', '')} <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">Rule files you upload (any format)</span>
          )}
        </div>
        {canManage && s.downloadable && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title="Include in the weekly check">
            <input type="checkbox" checked={s.enabled} onChange={(e) => update.mutate({ enabled: e.target.checked })} />
            Weekly
          </label>
        )}
      </div>
      {s.options.length > 0 && (
        <select
          value={s.option ?? ''}
          onChange={(e) => update.mutate({ option: e.target.value })}
          disabled={!canManage}
          aria-label="Package"
          className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs"
        >
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        <span>
          <b className="tabular-nums">{s.items.changed}</b> changed
        </span>
        <span>
          <b className="tabular-nums">{s.items.new}</b> new
          {s.items.new > 0 && <span className="text-muted-foreground"> ({s.items.relevantNew} for your telemetry)</span>}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {s.running ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <Loader2 className="w-3 h-3 animate-spin" /> Checking…
          </span>
        ) : s.lastCheckedAt ? (
          <>
            Checked {relativeTime(s.lastCheckedAt)}
            {s.stats && ` · ${s.stats.rules.toLocaleString()} rules, ${s.stats.unchanged} you have unchanged`}
          </>
        ) : (
          'Never checked'
        )}
      </div>
      {s.lastError && !s.running && (
        <p className="flex items-start gap-1 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {s.lastError}
        </p>
      )}
      {canCheck && s.downloadable && (
        <button
          onClick={() => check.mutate()}
          disabled={s.running || check.isPending}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', s.running && 'animate-spin')} /> Check now
        </button>
      )}
    </div>
  );
}

function ItemRow({ item, selected, onToggle }: { item: UpstreamItem; selected: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const [showFile, setShowFile] = useState(false);
  const { data: file } = useQuery({ queryKey: ['upstream-file', item.id], queryFn: () => getUpstreamItemContent(item.id), enabled: showFile });
  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${item.title}`} className="mt-1" />
        <button onClick={() => setOpen((v) => !v)} className="mt-0.5 text-muted-foreground" aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <button onClick={() => setOpen((v) => !v)} className="font-medium text-left hover:underline">
              {item.title}
            </button>
            <span className="px-1.5 rounded bg-muted text-[11px] leading-5">{SOURCE_FORMAT_LABELS[item.format] ?? item.format}</span>
            {item.severity && <SeverityBadge severity={item.severity} />}
            {item.kind === 'new' && item.relevant && (
              <span
                className="px-1.5 rounded border text-[11px] leading-5 text-emerald-700 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
                title="It reads telemetry your production or testing rules already use, so you likely collect it"
              >
                Your telemetry
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
            {item.kind === 'changed' && item.existing && (
              <span>
                Updates{' '}
                <Link to={`/pages/${item.existing.slug}`} className="text-primary hover:underline">
                  {item.existing.title}
                </Link>{' '}
                {item.existing.status && <StatusBadge status={item.existing.status} />}
              </span>
            )}
            {item.kind === 'changed' && item.changes && <span>Changed: {item.changes.map((c) => c.label).join(', ')}</span>}
            {item.techniques && <span className="font-mono">{item.techniques}</span>}
            {item.sourceStatus && item.kind === 'new' && <span>source status: {item.sourceStatus}</span>}
          </div>
          {open && (
            <div className="mt-2 space-y-2">
              {item.kind === 'changed' &&
                item.changes?.map((c) => (
                  <div key={c.field}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">{c.label}</div>
                    <div className="grid sm:grid-cols-2 gap-1.5 text-xs font-mono">
                      <pre className="whitespace-pre-wrap break-words rounded bg-red-500/10 text-red-700 dark:text-red-300 px-2 py-1 max-h-48 overflow-auto">{c.before || '(empty)'}</pre>
                      <pre className="whitespace-pre-wrap break-words rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-1 max-h-48 overflow-auto">
                        {c.after || '(empty)'}
                      </pre>
                    </div>
                  </div>
                ))}
              {item.telemetry.length > 0 && (
                <div className="flex flex-wrap gap-1 text-[11px] font-mono">
                  <span className="font-sans text-muted-foreground">Telemetry:</span>
                  {item.telemetry.map((t) => (
                    <span key={t} className="px-1 rounded bg-muted">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-xs">
                <span className="font-mono text-muted-foreground break-all">{item.path}</span>{' '}
                <button onClick={() => setShowFile((v) => !v)} className="text-primary hover:underline">
                  {showFile ? 'Hide the file' : 'Show the file'}
                </button>
              </div>
              {showFile && (
                <pre className="text-xs font-mono bg-muted/60 border border-border rounded-md p-2 max-h-80 overflow-auto whitespace-pre-wrap break-all">
                  {file ? file.content : 'Loading…'}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** New and changed rules in the repositories rules were imported from. */
export function UpstreamUpdatesPage() {
  const { hasPermission } = useAuth();
  const canImport = hasPermission('rules:create');
  const canManage = hasPermission('settings:manage');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>('changed');
  const [source, setSource] = useState('');
  const [relevantOnly, setRelevantOnly] = useState(true);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [keepSourceStatus, setKeepSourceStatus] = useState(false);
  const [convert, setConvert] = useState(true);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => folderRef.current?.setAttribute('webkitdirectory', ''), []);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [kind, source, relevantOnly, q]);

  const sources = useQuery({
    queryKey: ['upstream-sources'],
    queryFn: getUpstreamSources,
    // Poll while a check runs in the background
    refetchInterval: (query) => (query.state.data?.sources.some((s) => s.running) ? 3000 : false),
  });
  const anyRunning = sources.data?.sources.some((s) => s.running) ?? false;
  const prevRunning = useRef(anyRunning);
  useEffect(() => {
    if (prevRunning.current && !anyRunning) qc.invalidateQueries({ queryKey: ['upstream-items'] });
    prevRunning.current = anyRunning;
  }, [anyRunning, qc]);

  const items = useQuery({
    queryKey: ['upstream-items', kind, source, relevantOnly, q, page],
    queryFn: () => listUpstreamItems({ kind, source, relevant: kind === 'new' && relevantOnly, q, page }),
    placeholderData: keepPreviousData,
  });

  const totals = useMemo(() => {
    const list = sources.data?.sources ?? [];
    return {
      changed: list.reduce((n, s) => n + s.items.changed, 0),
      new: list.reduce((n, s) => n + s.items.new, 0),
      relevantNew: list.reduce((n, s) => n + s.items.relevantNew, 0),
    };
  }, [sources.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['upstream-sources'] });
    qc.invalidateQueries({ queryKey: ['upstream-items'] });
  };
  const upload = useMutation({
    mutationFn: async (list: FileList) =>
      checkUpstreamUpload(
        await Promise.all(
          Array.from(list)
            .filter((f) => RULE_FILE.test(f.name))
            .map(async (f) => ({ name: f.webkitRelativePath || f.name, content: await f.text() }))
        )
      ),
    onSuccess: (s) => {
      toast(`${s.rules.toLocaleString()} rules checked: ${s.changed} changed, ${s.new} new, ${s.unchanged} unchanged`, 'success');
      setSource('upload');
      refresh();
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not check the files'), 'error'),
  });
  const doImport = useMutation({
    mutationFn: () => importUpstreamItems(Array.from(selected), { status: keepSourceStatus ? 'source' : 'draft', convertTo: convert ? 'splunk' : null }),
    onSuccess: (r) => {
      toast(`${r.created.length} imported, ${r.updated.length} updated${r.errors.length ? ` · ${r.errors.length} errors` : ''}`, r.errors.length ? 'error' : 'success');
      setSelected(new Set());
      refresh();
      qc.invalidateQueries({ queryKey: ['rules'] });
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not import'), 'error'),
  });
  const dismiss = useMutation({
    mutationFn: () => dismissUpstreamItems(Array.from(selected)),
    onSuccess: (r) => {
      toast(`${r.dismissed} dismissed — they come back only if the source changes them again`, 'info');
      setSelected(new Set());
      refresh();
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not dismiss'), 'error'),
  });

  const list = items.data?.items ?? [];
  const pages = items.data ? Math.max(1, Math.ceil(items.data.total / items.data.pageSize)) : 1;
  const allOnPage = list.length > 0 && list.every((i) => selected.has(i.id));
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="max-w-6xl">
      <Breadcrumbs items={[{ label: 'Upstream Updates' }]} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <GitPullRequestArrow className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Upstream Updates</h1>
          <p className="text-sm text-muted-foreground">
            New and changed rules in the repositories your rules came from. Nothing is imported until you choose it
            {sources.data && ` · checked every ${sources.data.autoCheckDays} days`}.
          </p>
        </div>
        {canImport && (
          <div className="ml-auto">
            <button
              onClick={() => folderRef.current?.click()}
              disabled={upload.isPending}
              title="Compare a folder of rule files (e.g. a clone of a repository) with your rules — for servers without internet access, or for Sentinel"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
            >
              {upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderUp className="w-4 h-4" />}
              Check a folder
            </button>
            <input
              ref={folderRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) upload.mutate(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>

      {sources.error ? (
        <p className="text-destructive text-sm">{apiErrorMessage(sources.error)}</p>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
          {sources.data?.sources.map((s) => (
            <SourceCard key={s.key} s={s} canCheck={canImport} canManage={canManage} onChanged={refresh} />
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
          <div className="flex rounded-md border border-border overflow-hidden text-sm" role="tablist">
            {(['changed', 'new'] as Kind[]).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={cn('px-3 py-1.5', kind === k ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
              >
                {k === 'changed' ? `Changed (${totals.changed})` : `New (${totals.new})`}
              </button>
            ))}
          </div>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" className="px-2 py-1.5 rounded-md border border-border bg-background text-sm">
            <option value="">All sources</option>
            {sources.data?.sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {kind === 'new' && (
            <label className="flex items-center gap-1.5 text-sm cursor-pointer" title="Only rules that read telemetry your production or testing rules already use">
              <input type="checkbox" checked={relevantOnly} onChange={(e) => setRelevantOnly(e.target.checked)} />
              For my telemetry ({totals.relevantNew})
            </label>
          )}
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Title, technique or path…"
              aria-label="Search"
              className="pl-8 pr-2 py-1.5 rounded-md border border-border bg-background text-sm w-56"
            />
          </div>
        </div>

        {canImport && (
          <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-border bg-muted/30 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={allOnPage}
                onChange={() => setSelected(allOnPage ? new Set() : new Set(list.map((i) => i.id)))}
                aria-label="Select all on this page"
              />
              {selected.size ? `${selected.size} selected` : 'Select all on this page'}
            </label>
            {kind === 'new' && (
              <label className="flex items-center gap-1.5 cursor-pointer" title="Otherwise new rules start as drafts">
                <input type="checkbox" checked={keepSourceStatus} onChange={(e) => setKeepSourceStatus(e.target.checked)} />
                Keep the source's status
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer" title="Generate SPL for Sigma rules with the Sigma service">
              <input type="checkbox" checked={convert} onChange={(e) => setConvert(e.target.checked)} />
              Convert Sigma to SPL
            </label>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => doImport.mutate()}
                disabled={!selected.size || doImport.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
              >
                {doImport.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {kind === 'changed' ? 'Apply the changes' : 'Import'}
              </button>
              <button
                onClick={() => dismiss.mutate()}
                disabled={!selected.size || dismiss.isPending}
                title="Hide these versions; a later upstream change shows them again"
                className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {items.isLoading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </p>
        ) : list.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground text-center">
            {kind === 'changed'
              ? 'No imported rule has changed upstream since the last check.'
              : relevantOnly
                ? 'No new rule for your telemetry. Untick "For my telemetry" to see all new rules.'
                : 'No new rules. Check a source to look for some.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((i) => (
              <ItemRow key={i.id} item={i} selected={selected.has(i.id)} onToggle={() => toggle(i.id)} />
            ))}
          </ul>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-border text-sm">
            <span className="text-muted-foreground">
              {items.data?.total.toLocaleString()} rules · page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className="px-2 py-1 rounded border border-border disabled:opacity-40">
                Previous
              </button>
              <button onClick={() => setPage((p) => p + 1)} disabled={page >= pages} className="px-2 py-1 rounded border border-border disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
