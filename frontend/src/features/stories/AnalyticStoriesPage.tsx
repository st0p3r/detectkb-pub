import React, { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, DownloadCloud, ExternalLink, ListFilter, Loader2, Search, Upload } from 'lucide-react';
import { apiErrorMessage, fetchStoryDetails, getStory, importStoryFiles, listStories } from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { useDebounced } from '@/hooks/useDebounced';
import { cn } from '@/lib/utils';
import { safeHref } from '@/lib/safeUrl';

type Sort = 'rules' | 'name' | 'production';
const STATUS_ORDER = ['production', 'testing', 'draft', 'deprecated'];
const STATUS_BAR: Record<string, string> = { production: 'bg-emerald-500', testing: 'bg-amber-400', draft: 'bg-slate-400', deprecated: 'bg-red-400' };
const RULE_LIMIT = 60;

function StoryDetail({ id }: { id: number }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['story', id], queryFn: () => getStory(id) });
  const [narrative, setNarrative] = useState(false);
  const [allRules, setAllRules] = useState(false);
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;
  if (error || !data) return <p className="text-sm text-destructive">{apiErrorMessage(error, 'Could not load the story')}</p>;
  const total = data.rules.length;
  const rules = allRules ? data.rules : data.rules.slice(0, RULE_LIMIT);
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-xl font-semibold">{data.name}</h2>
          <div className="ml-auto flex gap-3 text-sm">
            <Link to={`/rules?story=${data.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <ListFilter className="w-4 h-4" /> In the rule list
            </Link>
            <Link to={`/graph?view=explore&focus=story:${data.id}`} className="text-primary hover:underline">
              Explore
            </Link>
          </div>
        </div>
        {(data.category || data.usecase) && <p className="text-xs text-muted-foreground">{[data.category, data.usecase].filter(Boolean).join(' · ')}</p>}
        {data.description ? (
          <p className="text-sm">{data.description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No description yet — download the story details or upload the story file.</p>
        )}
        {data.narrative && (
          <div>
            <button onClick={() => setNarrative((v) => !v)} className="text-xs text-primary hover:underline">
              {narrative ? 'Hide the narrative' : 'Show the narrative'}
            </button>
            {narrative && <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">{data.narrative}</p>}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
          <span>
            {total} rule{total === 1 ? '' : 's'} by status
          </span>
          <span>{STATUS_ORDER.filter((s) => data.statusCounts[s]).map((s) => `${data.statusCounts[s]} ${s}`).join(' · ')}</span>
        </div>
        <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
          {STATUS_ORDER.map((s) => (
            <span key={s} className={STATUS_BAR[s]} style={{ width: `${total ? ((data.statusCounts[s] ?? 0) / total) * 100 : 0}%` }} title={`${data.statusCounts[s] ?? 0} ${s}`} />
          ))}
        </div>
      </div>

      {data.techniques.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">ATT&CK techniques its rules detect ({data.techniques.length})</h3>
          <div className="flex flex-wrap gap-1.5">
            {data.techniques.map((t) => (
              <Link
                key={t.id}
                to={`/graph?view=chain&technique=${t.id}`}
                title={`${t.name} — ${t.activeRules} active rule${t.activeRules === 1 ? '' : 's'} in this story`}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs hover:bg-accent',
                  t.activeRules ? 'border-border' : 'border-dashed border-red-400 text-red-600 dark:text-red-400'
                )}
              >
                <span className="font-mono">{t.id}</span>
                <span className="max-w-[14rem] truncate">{t.name}</span>
                <span className="text-muted-foreground tabular-nums">{t.activeRules}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold mb-2">Rules ({total})</h3>
        <ul className="space-y-1">
          {rules.map((r) => (
            <li key={r.pageId} className="flex flex-wrap items-center gap-2 text-sm">
              <Link to={`/pages/${r.slug}`} className="text-primary hover:underline">
                {r.title}
              </Link>
              <StatusBadge status={r.status} />
              <SeverityBadge severity={r.severity} />
            </li>
          ))}
        </ul>
        {total > rules.length && (
          <button onClick={() => setAllRules(true)} className="mt-2 text-sm text-primary hover:underline">
            Show all {total}
          </button>
        )}
      </section>

      {data.references.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">References</h3>
          <ul className="space-y-1">
            {data.references.map((u) => (
              <li key={u} className="text-sm truncate">
                <a href={safeHref(u)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  {u} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.detailsFrom && <p className="text-xs text-muted-foreground">Details from {data.detailsFrom}</p>}
    </div>
  );
}

/** Splunk analytic stories: the scenarios ESCU detections belong to. */
export function AnalyticStoriesPage() {
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get('story')) || null;
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const [sort, setSort] = useState<Sort>('rules');
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['stories', q], queryFn: () => listStories(q), placeholderData: keepPreviousData });
  const stories = useMemo(() => {
    const list = [...(data?.stories ?? [])];
    return list.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'production' ? b.production - a.production : b.rules - a.rules) || a.name.localeCompare(b.name));
  }, [data, sort]);
  const missing = (data?.stories ?? []).filter((s) => !s.hasDetails).length;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['stories'] });
    qc.invalidateQueries({ queryKey: ['story'] });
  };
  const download = useMutation({
    mutationFn: () => fetchStoryDetails(missing === 0),
    onSuccess: (r) => {
      toast(`${r.fetched} stor${r.fetched === 1 ? 'y' : 'ies'} updated${r.missing.length ? ` · ${r.missing.length} not found` : ''}`, r.missing.length ? 'info' : 'success');
      refresh();
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not download the stories'), 'error'),
  });
  const upload = useMutation({
    mutationFn: async (files: FileList) => importStoryFiles(await Promise.all(Array.from(files).map(async (f) => ({ name: f.name, content: await f.text() })))),
    onSuccess: (r) => {
      toast(`${r.imported} stor${r.imported === 1 ? 'y' : 'ies'} imported${r.skipped.length ? ` · ${r.skipped.length} files were not stories` : ''}`, 'success');
      refresh();
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not import the files'), 'error'),
  });

  return (
    <div className="max-w-full">
      <Breadcrumbs items={[{ label: 'Analytic Stories' }]} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <BookMarked className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytic Stories</h1>
          <p className="text-sm text-muted-foreground">Splunk's attack scenarios, each grouping the ESCU detections that cover it</p>
        </div>
        {hasPermission('rules:create') && (
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => download.mutate()}
              disabled={download.isPending}
              title="From github.com/splunk/security_content (stories folder)"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
            >
              {download.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
              {missing ? `Download ${missing} missing descriptions` : 'Update descriptions'}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
              title="Story YAML files (stories/*.yml of security_content)"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
            >
              {upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload story files
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".yml,.yaml"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) upload.mutate(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>

      {error ? (
        <p className="text-destructive text-sm">{apiErrorMessage(error)}</p>
      ) : (
        <div className="grid lg:grid-cols-[24rem_1fr] gap-4 items-start">
          <div className="rounded-lg border border-border bg-card">
            <div className="p-3 space-y-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  data-page-search
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search stories…"
                  aria-label="Search stories"
                  className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{stories.length} stories</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className="ml-auto px-2 py-1 rounded-md border border-border bg-background text-xs">
                  <option value="rules">Most rules</option>
                  <option value="production">Most in production</option>
                  <option value="name">Name</option>
                </select>
              </div>
            </div>
            {isLoading ? (
              <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </p>
            ) : stories.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No stories yet. They appear when ESCU rules (Splunk security_content detections) are imported.
              </p>
            ) : (
              <ul className="max-h-[calc(100vh-16rem)] overflow-y-auto divide-y divide-border">
                {stories.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setParams({ story: String(s.id) })}
                      aria-current={selected === s.id}
                      className={cn('w-full text-left px-3 py-2 hover:bg-accent/50', selected === s.id && 'bg-primary/10')}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium truncate">{s.name}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground" title={`${s.production} in production of ${s.rules} rules`}>
                          {s.production}/{s.rules}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[s.category, `${s.techniques} technique${s.techniques === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-border bg-card p-5 min-w-0">
            {selected ? <StoryDetail id={selected} /> : <p className="text-sm text-muted-foreground">Pick a story to see its rules and techniques.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
