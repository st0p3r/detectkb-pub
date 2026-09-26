import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Crosshair, ExternalLink, Loader2, RefreshCw, Search, Shield, Upload } from 'lucide-react';
import {
  apiErrorMessage,
  getReference,
  listReferenceDatasets,
  listReferences,
  updateReferenceData,
  uploadReferenceData,
  type CoveringRule,
  type ReferenceKind,
  type ReferenceSummary,
} from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const KINDS: { kind: ReferenceKind; blurb: string }[] = [
  { kind: 'lolbas', blurb: 'Windows binaries, scripts and libraries abused by attackers (Living Off The Land).' },
  { kind: 'gtfobins', blurb: 'Unix binaries that can be abused to bypass local security restrictions.' },
  { kind: 'loldrivers', blurb: 'Vulnerable and malicious Windows drivers (BYOVD).' },
];

type Covered = 'all' | 'yes' | 'no';

const attackUrl = (id: string) => `https://attack.mitre.org/techniques/${id.replace('.', '/')}/`;

function RuleList({ rules }: { rules: CoveringRule[] }) {
  if (!rules.length) {
    return <p className="text-sm text-muted-foreground">No detection rule mentions this yet.</p>;
  }
  return (
    <ul className="space-y-1">
      {rules.map((r) => (
        <li key={r.pageId} className="flex flex-wrap items-center gap-2 text-sm">
          <Link to={`/pages/${r.slug}`} className="text-primary hover:underline">{r.title}</Link>
          <StatusBadge status={r.status} />
          <SeverityBadge severity={r.severity} />
        </li>
      ))}
    </ul>
  );
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{children}</h4>
);
const Code = ({ children }: { children: React.ReactNode }) => (
  <pre className="px-3 py-2 rounded-md bg-zinc-900 text-zinc-100 text-xs font-mono whitespace-pre-wrap break-all">{children}</pre>
);
const asArr = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
const asStr = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function LinkList({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <ul className="space-y-0.5 text-sm">
      {urls.map((u) => (
        <li key={u}>
          <a href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline break-all">
            {u} <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function Detail({ kind, entryKey }: { kind: ReferenceKind; entryKey: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['reference', kind, entryKey], queryFn: () => getReference(kind, entryKey) });
  if (isLoading || !data) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }
  const d = data.data;
  return (
    <div className="space-y-4">
      <div>
        <H>Detection rules mentioning it ({data.rules.length})</H>
        <RuleList rules={data.rules} />
      </div>

      {kind === 'lolbas' && (
        <>
          {asStr(d.description) && <p className="text-sm">{asStr(d.description)}</p>}
          <div>
            <H>Abuse</H>
            <div className="space-y-2">
              {asArr<Record<string, string>>(d.commands).map((c, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-muted font-medium">{c.category}</span>
                    {c.mitre && (
                      <a href={attackUrl(c.mitre)} target="_blank" rel="noreferrer" className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-mono">
                        {c.mitre}
                      </a>
                    )}
                    {c.privileges && <span className="text-muted-foreground">Privileges: {c.privileges}</span>}
                  </div>
                  <p className="text-sm text-foreground/80">{c.description}</p>
                  <Code>{c.command}</Code>
                </div>
              ))}
            </div>
          </div>
          {asArr<string>(d.paths).length > 0 && (
            <div>
              <H>Paths</H>
              <Code>{asArr<string>(d.paths).join('\n')}</Code>
            </div>
          )}
          {asArr<{ type: string; value: string }>(d.detections).length > 0 && (
            <div>
              <H>Public detections</H>
              <ul className="space-y-0.5 text-sm">
                {asArr<{ type: string; value: string }>(d.detections).map((x, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">{x.type}: </span>
                    {/^https?:/.test(x.value) ? (
                      <a href={x.value} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{x.value}</a>
                    ) : (
                      x.value
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <H>Resources</H>
            <LinkList urls={asArr<string>(d.resources)} />
          </div>
        </>
      )}

      {kind === 'gtfobins' && (
        <>
          {asStr(d.comment) && <p className="text-sm">{asStr(d.comment)}</p>}
          {asArr<{ label: string; mitre: string[]; examples: { code: string; comment: string; contexts: string[] }[] }>(d.functions).map((f) => (
            <div key={f.label} className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="px-1.5 py-0.5 rounded bg-muted font-medium">{f.label}</span>
                {f.mitre.map((m) => (
                  <a key={m} href={attackUrl(m)} target="_blank" rel="noreferrer" className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-mono">{m}</a>
                ))}
              </div>
              {f.examples.map((ex, i) => (
                <div key={i} className="space-y-1">
                  {ex.contexts.length > 0 && <p className="text-xs text-muted-foreground">Works: {ex.contexts.join(', ')}</p>}
                  {ex.comment && <p className="text-sm text-foreground/80">{ex.comment}</p>}
                  <Code>{ex.code}</Code>
                </div>
              ))}
            </div>
          ))}
          <LinkList urls={[`https://gtfobins.github.io/gtfobins/${encodeURIComponent(data.name)}/`]} />
        </>
      )}

      {kind === 'loldrivers' && (
        <>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="px-1.5 py-0.5 rounded bg-muted font-medium">{asStr(d.category)}</span>
            {d.verified === true && <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">verified</span>}
            {asStr(d.created) && <span className="text-muted-foreground">Added {asStr(d.created)}</span>}
          </div>
          {asStr(d.description) && <p className="text-sm whitespace-pre-wrap">{asStr(d.description)}</p>}
          {asStr(d.command) && (
            <div>
              <H>Example ({asStr(d.usecase)})</H>
              <Code>{asStr(d.command)}</Code>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <H>File names</H>
              <p className="text-sm font-mono break-all">{asArr<string>(d.filenames).join(', ') || '—'}</p>
            </div>
            <div>
              <H>Vendor / product</H>
              <p className="text-sm">{[...asArr<string>(d.companies), ...asArr<string>(d.products)].join(', ') || '—'}</p>
            </div>
          </div>
          <div>
            <H>Hashes ({asArr<string>(d.hashes).length} from {asStr(d.sampleCount)} samples)</H>
            <Code>{asArr<string>(d.hashes).slice(0, 12).join('\n')}{asArr<string>(d.hashes).length > 12 ? '\n…' : ''}</Code>
          </div>
          <div>
            <H>Resources</H>
            <LinkList urls={asArr<string>(d.resources)} />
          </div>
          <LinkList urls={[`https://www.loldrivers.io/drivers/${data.key}/`]} />
        </>
      )}
    </div>
  );
}

function EntryRow({ kind, item, initiallyOpen }: { kind: ReferenceKind; item: ReferenceSummary; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initiallyOpen) {
      setOpen(true);
      ref.current?.scrollIntoView({ block: 'start' });
    }
  }, [initiallyOpen]);
  return (
    <div ref={ref} className="rounded-lg border border-border bg-card">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full text-left px-4 py-3 flex items-start gap-3">
        {open ? <ChevronDown className="w-4 h-4 mt-1 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 mt-1 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold font-mono">{item.name}</span>
            {item.categories.slice(0, 5).map((c) => (
              <span key={c} className="px-1.5 py-0.5 rounded bg-muted text-xs">{c}</span>
            ))}
            {item.categories.length > 5 && <span className="text-xs text-muted-foreground">+{item.categories.length - 5}</span>}
            <span
              className={cn(
                'ml-auto px-2 py-0.5 rounded-full text-xs font-medium border',
                item.rules.length ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-muted text-muted-foreground border-border'
              )}
            >
              {item.rules.length ? `${item.rules.length} rule${item.rules.length === 1 ? '' : 's'}` : 'no rules'}
            </span>
          </div>
          {item.description && <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>}
        </div>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-4 bg-muted/10">
          <Detail kind={kind} entryKey={item.key} />
        </div>
      )}
    </div>
  );
}

export function AttackerToolsPage() {
  const [params, setParams] = useSearchParams();
  const kind = (KINDS.find((k) => k.kind === params.get('kind'))?.kind ?? 'lolbas') as ReferenceKind;
  const focusKey = params.get('key');
  const [search, setSearch] = useState('');
  const [covered, setCovered] = useState<Covered>('all');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const canManage = hasPermission('settings:manage');

  const { data: datasets = [] } = useQuery({ queryKey: ['reference-datasets'], queryFn: listReferenceDatasets });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['references', kind],
    queryFn: () => listReferences(kind),
  });
  const dataset = datasets.find((d) => d.kind === kind);

  const categories = useMemo(() => Array.from(new Set(items.flatMap((i) => i.categories))).sort(), [items]);
  const filtered = items.filter((i) => {
    const q = search.trim().toLowerCase();
    if (q && !i.name.toLowerCase().includes(q) && !i.description.toLowerCase().includes(q)) return false;
    if (category && !i.categories.includes(category)) return false;
    if (covered === 'yes' && !i.rules.length) return false;
    if (covered === 'no' && i.rules.length) return false;
    return true;
  });

  function selectKind(k: ReferenceKind) {
    setCategory('');
    setParams({ kind: k });
  }

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['reference-datasets'] }),
      queryClient.invalidateQueries({ queryKey: ['references'] }),
    ]);
  }

  async function handleUpdate() {
    setBusy(true);
    try {
      const results = await updateReferenceData([kind]);
      const r = results[0];
      if (r?.error) toast(`Download failed: ${r.error}. You can upload the file instead.`, 'error');
      else toast(`Loaded ${r?.count ?? 0} entries`, 'success');
      await refreshAll();
    } catch (err) {
      toast(apiErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadReferenceData(kind, file.name, await file.text());
      toast(`Loaded ${r.count} entries from ${file.name}`, 'success');
      await refreshAll();
    } catch (err) {
      toast(apiErrorMessage(err, 'Upload failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <Breadcrumbs items={[{ label: 'Attacker Tools' }]} />
      <div className="flex items-center gap-3 mb-5">
        <Crosshair className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Attacker Tools</h1>
          <p className="text-sm text-muted-foreground">
            Community references of abusable binaries and drivers, and which of your rules mention them.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5" role="tablist">
        {KINDS.map(({ kind: k, blurb }) => {
          const ds = datasets.find((d) => d.kind === k);
          return (
            <button
              key={k}
              role="tab"
              aria-selected={k === kind}
              onClick={() => selectKind(k)}
              className={cn(
                'text-left rounded-lg border px-4 py-3 transition-colors',
                k === kind ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-accent'
              )}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{ds?.label ?? k}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ds?.count ? `${ds.covered} / ${ds.count} covered` : 'not loaded'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{blurb}</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 text-xs text-muted-foreground">
        <span>
          {dataset?.fetchedAt ? (
            <>
              Updated {relativeTime(dataset.fetchedAt)} from{' '}
              <span className="font-mono">{dataset.source}</span> ·{' '}
            </>
          ) : null}
          Data ©{' '}
          <a href={dataset?.site} target="_blank" rel="noreferrer" className="underline">{dataset?.label}</a>{' '}
          ({dataset?.license})
        </span>
        {canManage && (
          <div className="flex gap-2">
            <button
              onClick={handleUpdate}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-foreground hover:bg-accent disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Update from source
            </button>
            <button
              onClick={() => uploadInput.current?.click()}
              disabled={busy}
              title={`Upload ${dataset?.url.split('/').pop()} (for servers without internet)`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-foreground hover:bg-accent disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload file
            </button>
            <input
              ref={uploadInput}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                handleUpload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>

      {!isLoading && !items.length ? (
        <div className="text-center py-16 rounded-lg border border-dashed border-border">
          <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{dataset?.label} data is not loaded</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            DetectKB downloads it from{' '}
            <a href={dataset?.url} target="_blank" rel="noreferrer" className="underline break-all">{dataset?.url}</a> on first
            start. {canManage
              ? 'Use “Update from source”, or upload that file if this server has no internet access.'
              : 'Ask an administrator to load it.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or description…"
                className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
              className="px-3 py-2 rounded-md border border-border bg-background text-sm"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={covered}
              onChange={(e) => setCovered(e.target.value as Covered)}
              aria-label="Filter by rule coverage"
              className="px-3 py-2 rounded-md border border-border bg-background text-sm"
            >
              <option value="all">All</option>
              <option value="yes">Mentioned by a rule</option>
              <option value="no">Not mentioned by any rule</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {filtered.length} of {items.length} · A rule “mentions” an entry when its query or Sigma source names the
            binary (e.g. <code>certutil.exe</code>, <code>/usr/bin/find</code>), driver file or a known driver hash.
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((item) => (
                <EntryRow key={item.key} kind={kind} item={item} initiallyOpen={item.key === focusKey} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
