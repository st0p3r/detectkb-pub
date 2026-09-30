import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Pencil, X } from 'lucide-react';
import { apiErrorMessage, getPage } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthContext';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { SourceBadge } from '@/components/ui/SourceBadge';
import { RuleQueryTabs } from './RuleQueryTabs';
import { safeHref } from '@/lib/safeUrl';

interface RulePreviewDrawerProps {
  slug: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Filter the list by a technique chip */
  onTechnique: (technique: string) => void;
}

const chips = (v?: string | null) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-3 border-b border-border/60">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

/** A rule's details in a side panel, so the list stays in place while browsing rules. */
export function RulePreviewDrawer({ slug, onClose, onPrev, onNext, onTechnique }: RulePreviewDrawerProps) {
  const { hasPermission } = useAuth();
  const { data: page, isLoading, error } = useQuery({ queryKey: ['page', slug], queryFn: () => getPage(slug), staleTime: 30_000 });
  const rule = page?.rule;
  const navBtn = 'p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none';

  return (
    <aside
      aria-label="Rule preview"
      className="fixed right-0 top-14 bottom-0 z-30 w-full sm:w-[min(640px,55vw)] bg-card border-l border-border shadow-2xl flex flex-col animate-slide-in-right"
    >
      <header className="flex items-start gap-2 px-5 py-3 border-b border-border">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold leading-snug">{page?.title ?? (isLoading ? 'Loading…' : 'Rule')}</h2>
          {rule && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <StatusBadge status={rule.status} />
              <SeverityBadge severity={rule.severity} />
              {rule.sourceFormat && <SourceBadge source={rule.sourceFormat} />}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={onPrev} disabled={!onPrev} title="Previous rule (k)" aria-label="Previous rule" className={navBtn}>
            <ChevronUp className="w-4 h-4" />
          </button>
          <button onClick={onNext} disabled={!onNext} title="Next rule (j)" aria-label="Next rule" className={navBtn}>
            <ChevronDown className="w-4 h-4" />
          </button>
          <button onClick={onClose} title="Close (Esc)" aria-label="Close preview" className={navBtn}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>
      <div className="flex gap-2 px-5 py-2 border-b border-border bg-muted/20">
        <Link to={`/pages/${slug}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent" title="Open the full page (o)">
          <ExternalLink className="w-3.5 h-3.5" /> Open page
        </Link>
        {hasPermission('pages:update') && (
          <Link to={`/pages/${slug}/edit`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent" title="Edit (e)">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Link>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </p>
        ) : error ? (
          <p className="p-5 text-sm text-destructive">{apiErrorMessage(error, 'Could not load the rule')}</p>
        ) : page && rule ? (
          <>
            {(rule.mitreTechniques || rule.mitreTactics) && (
              <Section title="ATT&CK">
                <div className="flex flex-wrap gap-1">
                  {chips(rule.mitreTactics).map((t) => (
                    <span key={t} className="px-1.5 py-px rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 text-[11px] font-mono">
                      {t}
                    </span>
                  ))}
                  {chips(rule.mitreTechniques).map((t) => (
                    <button
                      key={t}
                      onClick={() => onTechnique(t)}
                      title={`Only rules for ${t}`}
                      className="px-1.5 py-px rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-[11px] font-mono hover:ring-1 hover:ring-blue-400"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Section>
            )}
            {(rule.dataSource || page.sysmonEvents?.length) && (
              <Section title="Data">
                {rule.dataSource && <p className="text-xs font-mono text-foreground/80 break-words mb-1.5">{rule.dataSource}</p>}
                {page.sysmonEvents?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {page.sysmonEvents.map(({ sysmonEvent: e, source }) => (
                      <Link
                        key={e.id}
                        to={`/sysmon-events?event=${e.eventId}`}
                        title={source === 'auto' ? 'Detected from the query / Sigma logsource' : 'Linked by hand'}
                        className="px-1.5 py-px rounded border border-indigo-500/30 text-indigo-600 dark:text-indigo-300 text-[11px] hover:bg-indigo-500/10"
                      >
                        Sysmon {e.eventId} · {e.name}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </Section>
            )}
            {page.tags.length > 0 && (
              <Section title="Tags">
                <div className="flex flex-wrap gap-1">
                  {page.tags.map(({ tag }) => (
                    <span key={tag.id} className="px-1.5 py-px rounded-full bg-muted text-muted-foreground text-[11px]">
                      #{tag.name}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            <div className="-mx-1">
              <RuleQueryTabs rule={rule} slug={slug} />
            </div>

            {rule.falsePositives && (
              <Section title="False positives">
                <p className="text-sm text-foreground/80 whitespace-pre-wrap">{rule.falsePositives}</p>
              </Section>
            )}
            {page.contentMd.trim() && (
              <Section title="Description">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.contentMd}</ReactMarkdown>
                </div>
              </Section>
            )}
            {rule.references && (
              <Section title="References">
                <ul className="space-y-0.5">
                  {rule.references
                    .split('\n')
                    .filter(Boolean)
                    .map((r) => (
                      <li key={r}>
                        <a href={safeHref(r)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline break-all">
                          {r.trim()}
                        </a>
                      </li>
                    ))}
                </ul>
              </Section>
            )}
          </>
        ) : null}
      </div>
    </aside>
  );
}
