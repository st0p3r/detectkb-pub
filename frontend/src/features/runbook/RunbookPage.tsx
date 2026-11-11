import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { AlertTriangle, BookOpen, Check, ClipboardList, Copy, ExternalLink, FileSearch, Loader2, Pencil, Printer, Radar, ScrollText, ShieldCheck, Siren, Target } from 'lucide-react';
import { QUERY_LANGUAGE_LABELS, apiErrorMessage, getPage, getRunbook, type Runbook, type RunbookSteps } from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { ValidationBadge } from '@/components/ui/ValidationBadge';
import { CollectionBadge, FeedBadge } from '@/features/collection/CollectionBadge';
import { AnalyticCard } from '@/features/attack/AttackCoveragePage';
import { useAuth } from '@/features/auth/AuthContext';
import { safeHref } from '@/lib/safeUrl';
import { relativeDay } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

function Markdown({ children }: { children: string }) {
  return (
    <div className="rb-md md-auto text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function Section({ icon: Icon, title, hint, children, tone }: { icon: React.ElementType; title: string; hint?: React.ReactNode; children: React.ReactNode; tone?: 'primary' | 'danger' }) {
  return (
    <section
      className={cn(
        'rounded-lg border bg-card p-5 break-inside-avoid',
        tone === 'primary' ? 'border-primary/40' : tone === 'danger' ? 'border-red-500/30' : 'border-border'
      )}
    >
      <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold mb-3">
        <Icon className={cn('w-4 h-4', tone === 'primary' ? 'text-primary' : tone === 'danger' ? 'text-red-500' : 'text-muted-foreground')} />
        {title}
        {hint && <span className="font-normal text-xs text-muted-foreground">{hint}</span>}
      </h2>
      {children}
    </section>
  );
}

function Query({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <button
          onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
          className="print:hidden inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="rounded-md bg-zinc-900 text-zinc-100 text-xs p-3 overflow-x-auto whitespace-pre-wrap break-words print:bg-white print:text-black print:border print:border-zinc-300">{text}</pre>
    </div>
  );
}

const importedNote = (s: RunbookSteps) => (s.source === 'imported' ? 'from the investigation guide the rule was imported with' : undefined);

/** Steps for the analyst, or a prompt to write them. */
function Steps({ steps, empty, editHref }: { steps: RunbookSteps | null; empty: string; editHref: string | null }) {
  if (steps) return <Markdown>{steps.markdown}</Markdown>;
  return (
    <p className="text-sm text-muted-foreground">
      {empty}{' '}
      {editHref && (
        <Link to={editHref} className="print:hidden text-primary hover:underline">
          Write them
        </Link>
      )}
    </p>
  );
}

function Techniques({ runbook }: { runbook: Runbook }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {runbook.techniques.map((t) => (
        <div key={t.id} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <a href={safeHref(t.url)} target="_blank" rel="noreferrer" className="font-medium text-sm hover:underline">
              <span className="font-mono text-xs text-muted-foreground mr-1.5">{t.id}</span>
              {t.name}
            </a>
            <span className="text-xs text-muted-foreground">{t.tactics.join(' · ')}</span>
            <Link to={`/rules?technique=${t.id}`} className="print:hidden ml-auto text-xs text-primary hover:underline">
              Other rules
            </Link>
          </div>
          {t.description && <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{t.description}</p>}
          {t.mitigations.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Mitigations:</span>
              {t.mitigations.map((m) => (
                <a key={m.id} href={safeHref(m.url)} target="_blank" rel="noreferrer" title={m.description} className="px-1.5 py-0.5 rounded border border-border hover:bg-accent">
                  {m.name}
                </a>
              ))}
            </div>
          )}
          {t.analytics.length > 0 && (
            <div className="mt-2 print:hidden">
              <button onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Radar className="w-3.5 h-3.5" /> What MITRE suggests looking at ({t.analytics.length})
              </button>
              {open === t.id && (
                <div className="grid lg:grid-cols-2 gap-2 mt-2">
                  {t.analytics.map((a) => (
                    <AnalyticCard key={a.id} analytic={a} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * A rule as the analyst handling its alert needs it: what fired, what to
 * check, what is usually benign and what to do when it is real.
 */
export function RunbookPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { hasPermission } = useAuth();
  // The runbook is keyed by the rule's page id; the URL has the slug
  const { data: page, error: pageError } = useQuery({ queryKey: ['page', slug], queryFn: () => getPage(slug), staleTime: 30_000 });
  const { data: rb, error } = useQuery({ queryKey: ['runbook', page?.id], queryFn: () => getRunbook(page!.id), enabled: !!page?.id });
  const failure = pageError || error;
  useDocumentTitle(rb ? `Runbook: ${rb.title}` : null);

  if (failure) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <p className="text-sm text-destructive">{apiErrorMessage(failure, 'Could not load the runbook')}</p>
        <Link to="/rules" className="mt-3 inline-block text-sm text-primary hover:underline">
          Back to the rules
        </Link>
      </div>
    );
  }
  if (!rb) {
    return (
      <p className="flex items-center gap-2 py-20 justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading runbook…
      </p>
    );
  }

  const editHref = hasPermission('pages:update') ? `/pages/${rb.slug}/edit` : null;
  const overdue = !!rb.nextReviewAt && new Date(rb.nextReviewAt) < new Date();
  const notRunning = rb.status !== 'production' && rb.status !== 'testing';

  return (
    <div className="max-w-4xl mx-auto runbook">
      <div className="print:hidden">
        <Breadcrumbs items={[{ label: 'Detection Rules', to: '/rules' }, { label: rb.title, to: `/pages/${rb.slug}` }, { label: 'Runbook' }]} />
      </div>

      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ClipboardList className="w-3.5 h-3.5" /> Alert runbook
            </div>
            <h1 dir="auto" className="text-2xl font-semibold tracking-tight mt-1">{rb.title}</h1>
          </div>
          <div className="print:hidden flex flex-wrap gap-2">
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent">
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <Link to={`/pages/${rb.slug}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent">
              <BookOpen className="w-3.5 h-3.5" /> Full rule
            </Link>
            {editHref && (
              <Link to={editHref} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 text-xs text-muted-foreground">
          <SeverityBadge severity={rb.severity} />
          <StatusBadge status={rb.status} />
          {rb.validation.status !== 'never' && <ValidationBadge status={rb.validation.status} />}
          {rb.logs.known && rb.logs.feed !== 'unknown' && <FeedBadge feed={rb.logs.feed} />}
          <span>Owner: {rb.owner ? <b className="text-foreground font-medium">{rb.owner.username}</b> : 'nobody'}</span>
          <span className={cn(overdue && 'text-red-600 dark:text-red-400 font-medium')}>
            {rb.nextReviewAt ? `Review ${relativeDay(rb.nextReviewAt)}` : rb.lastReviewedAt ? `Reviewed ${relativeDay(rb.lastReviewedAt)}` : 'Never reviewed'}
          </span>
          <span>Updated {new Date(rb.updatedAt).toLocaleDateString()}</span>
        </div>
      </header>

      {(notRunning || rb.logs.feed === 'blind' || rb.validation.status === 'failed') && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm space-y-1">
          {notRunning && (
            <p className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 flex-shrink-0" />
              This rule is {rb.status}: it is not deployed, so alerts from it are not expected.
            </p>
          )}
          {rb.logs.feed === 'blind' && (
            <p className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 flex-shrink-0" />
              The logs it reads are marked as not collected, so it cannot fire today.
            </p>
          )}
          {rb.validation.status === 'failed' && (
            <p className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 flex-shrink-0" />
              In its latest lab test this rule did not detect the attack: a quiet rule does not mean nothing happened.
            </p>
          )}
        </div>
      )}

      <div className="space-y-4">
        <Section icon={Target} title="What this alert means">
          {rb.overview ? <Markdown>{rb.overview}</Markdown> : <p className="text-sm text-muted-foreground">No description on the rule.</p>}
          {rb.techniques.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-3 text-xs">
              <span className="text-muted-foreground">ATT&CK:</span>
              {rb.techniques.map((t) => (
                <a key={t.id} href={safeHref(t.url)} target="_blank" rel="noreferrer" className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 hover:underline">
                  <span className="font-mono">{t.id}</span> {t.name}
                </a>
              ))}
            </div>
          )}
        </Section>

        <Section icon={FileSearch} title="Check first" hint={rb.triage ? importedNote(rb.triage) : undefined} tone="primary">
          <Steps steps={rb.triage} empty="No triage steps are written for this rule yet." editHref={editHref} />
        </Section>

        <Section icon={AlertTriangle} title="Usually benign when" hint="known false positives">
          {rb.falsePositives.length ? (
            <ul dir="auto" className="list-disc pl-5 space-y-1 text-sm">
              {rb.falsePositives.map((fp, i) => (
                <li key={i}>{fp}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No false positives are noted.{' '}
              {editHref && (
                <Link to={editHref} className="print:hidden text-primary hover:underline">
                  Add them
                </Link>
              )}
            </p>
          )}
        </Section>

        <Section icon={Siren} title="If it is real" hint={rb.response ? importedNote(rb.response) : undefined} tone="danger">
          <Steps steps={rb.response} empty="No response steps are written for this rule yet." editHref={editHref} />
          {!rb.response && rb.techniques.some((t) => t.mitigations.length) && (
            <p className="mt-2 text-xs text-muted-foreground">ATT&CK lists mitigations for the techniques below; they are a starting point for containment.</p>
          )}
        </Section>

        {(rb.queries.spl || rb.queries.native) && (
          <Section icon={ScrollText} title="The detection" hint="run it over a wider time range to see how far it goes">
            <div className="space-y-3">
              {rb.queries.spl && <Query label="SPL (Splunk)" text={rb.queries.spl} />}
              {rb.queries.native && <Query label={QUERY_LANGUAGE_LABELS[rb.queries.nativeLanguage ?? ''] ?? rb.queries.nativeLanguage ?? 'Query'} text={rb.queries.native} />}
            </div>
          </Section>
        )}

        {rb.logs.telemetry.length > 0 && (
          <Section icon={ScrollText} title="Logs it reads" hint="where to look for the surrounding activity">
            <ul className="space-y-1.5">
              {rb.logs.telemetry.map((t) => (
                <li key={t.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    to={t.key.startsWith('sysmon:') ? `/sysmon-events?event=${t.key.slice(7)}` : `/log-sources?event=${encodeURIComponent(t.key)}`}
                    className="hover:underline"
                  >
                    {t.label}
                  </Link>
                  {rb.logs.known && <CollectionBadge state={t.state} />}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {rb.techniques.length > 0 && (
          <Section icon={Target} title="The technique behind it">
            <Techniques runbook={rb} />
          </Section>
        )}

        {rb.related.length > 0 && (
          <Section icon={ClipboardList} title="Related rules" hint="same technique — did they fire too?">
            <ul className="space-y-1.5">
              {rb.related.map((r) => (
                <li key={r.pageId} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link to={`/runbook/${r.slug}`} className="text-primary hover:underline">
                    {r.title}
                  </Link>
                  <StatusBadge status={r.status} />
                  <SeverityBadge severity={r.severity} />
                </li>
              ))}
            </ul>
            {rb.relatedTotal > rb.related.length && (
              <Link to={`/rules?technique=${rb.techniques[0]?.id ?? ''}`} className="print:hidden mt-2 inline-block text-xs text-primary hover:underline">
                All {rb.relatedTotal} related rules
              </Link>
            )}
          </Section>
        )}

        {rb.references.length > 0 && (
          <Section icon={ExternalLink} title="References">
            <ul className="space-y-1 text-sm">
              {rb.references.map((ref, i) => (
                <li key={i} className="break-all">
                  {/^https?:\/\//i.test(ref) ? (
                    <a href={safeHref(ref)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {ref}
                    </a>
                  ) : (
                    ref
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
