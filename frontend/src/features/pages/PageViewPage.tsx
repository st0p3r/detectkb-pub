import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, Trash2, Copy, Check, Link2, Star, Pin, PinOff, Download, Network } from 'lucide-react';
import { getPage, deletePage, updatePage, getBacklinks, updateSplCommand, exportPageAsPDF, downloadGeneratedDoc, downloadSigmaRule, apiErrorMessage, getPageReferences, type Page } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { RuleQueryTabs } from '@/features/rules/RuleQueryTabs';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { TypeBadge } from '@/components/ui/TypeBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { BasisBadge } from '@/components/ui/BasisBadge';
import { LINK_BASIS, basisChip } from '@/lib/linkBasis';
import { safeHref } from '@/lib/safeUrl';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1 rounded bg-background/80 border border-border text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
      title="Copy code"
      aria-label="Copy code"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function RulePanel({ rule, slug }: { rule: NonNullable<Page['rule']>; slug: string }) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  function toggleSection(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const tactics = (rule.mitreTactics ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const techniques = (rule.mitreTechniques ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  return (
    <div className="border-b border-border bg-muted/10">
      <div className="px-6 py-4 flex flex-wrap items-center gap-3 border-b border-border/60">
        <StatusBadge status={rule.status} />
        <SeverityBadge severity={rule.severity} />
        {rule.dataSource && (
          <span className="text-xs text-muted-foreground font-mono">
            <span className="text-muted-foreground/60 mr-1">source:</span>
            {rule.dataSource}
          </span>
        )}
      </div>

      <RuleQueryTabs rule={rule} slug={slug} />

      {(tactics.length > 0 || techniques.length > 0) && (
        <div className="px-6 py-4 border-b border-border/60 space-y-2">
          {tactics.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-24 shrink-0">Tactics</span>
              {tactics.map((t) => (
                <Link
                  key={t}
                  to={`/rules?tactic=${encodeURIComponent(t)}`}
                  className="px-2 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 text-xs font-mono hover:ring-1 hover:ring-purple-400 transition-all"
                >
                  {t}
                </Link>
              ))}
            </div>
          )}
          {techniques.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-24 shrink-0">Techniques</span>
              {techniques.map((t) => (
                <Link
                  key={t}
                  to={`/rules?technique=${encodeURIComponent(t)}`}
                  className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs font-mono hover:ring-1 hover:ring-blue-400 transition-all"
                >
                  {t}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {rule.falsePositives && (
        <CollapsibleSection
          label="False Positives"
          isOpen={!!openSections['fp']}
          onToggle={() => toggleSection('fp')}
        >
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{rule.falsePositives}</p>
        </CollapsibleSection>
      )}

      {rule.references && (
        <CollapsibleSection
          label="References"
          isOpen={!!openSections['refs']}
          onToggle={() => toggleSection('refs')}
        >
          <ul className="space-y-1">
            {rule.references.split('\n').filter(Boolean).map((ref, i) => (
              <li key={i}>
                <a
                  href={safeHref(ref)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline break-all"
                >
                  {ref.trim()}
                </a>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {rule.testNotes && (
        <CollapsibleSection
          label="Test Notes"
          isOpen={!!openSections['notes']}
          onToggle={() => toggleSection('notes')}
        >
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{rule.testNotes}</p>
        </CollapsibleSection>
      )}

    </div>
  );
}

const REFERENCE_LABELS = { lolbas: 'LOLBAS', gtfobins: 'GTFOBins', loldrivers: 'LOLDrivers' } as const;

/** LOLBAS / GTFOBins / LOLDrivers entries this rule mentions. */
function ReferencesBar({ pageId }: { pageId: number }) {
  const { data: refs = [] } = useQuery({ queryKey: ['page-references', pageId], queryFn: () => getPageReferences(pageId) });
  if (!refs.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-6 py-3 border-b border-border bg-muted/10">
      <span className="text-xs font-medium text-muted-foreground mr-1">Attacker tools:</span>
      {refs.map((r) => (
        <Link
          key={`${r.kind}:${r.key}`}
          to={`/attacker-tools?kind=${r.kind}&key=${encodeURIComponent(r.key)}`}
          title={LINK_BASIS['text-match'].hint}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-dashed border-border bg-background text-xs hover:bg-accent"
        >
          <span className="text-muted-foreground">{REFERENCE_LABELS[r.kind]}</span> {r.name}
        </Link>
      ))}
      <BasisBadge basis="text-match" always className="ml-1" />
    </div>
  );
}

/** Sysmon events a rule / data source depends on, linking to the Sysmon reference. */
function SysmonLinksBar({ links }: { links: NonNullable<Page['sysmonEvents']> }) {
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-6 py-3 border-b border-border bg-muted/10">
      <span className="text-xs font-medium text-muted-foreground mr-1">Sysmon events:</span>
      {links.map(({ source, basis, sysmonEvent: e }) => {
        const b = source === 'manual' ? 'manual' : basis;
        return (
          <Link
            key={e.eventId}
            to={`/sysmon-events?event=${e.eventId}`}
            title={LINK_BASIS[b]?.hint}
            className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-background text-xs hover:bg-accent', basisChip(b))}
          >
            <span className="font-mono font-semibold">{e.eventId}</span>
            {e.name}
            <BasisBadge basis={b} />
          </Link>
        );
      })}
    </div>
  );
}

/** Other telemetry a rule / data source reads, and the analytic stories of an ESCU rule. */
function TelemetryBar({ page }: { page: Page }) {
  const logs = page.logEvents ?? [];
  const stories = page.stories ?? [];
  if (!logs.length && !stories.length) return null;
  const chip = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-background text-xs hover:bg-accent';
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-6 py-3 border-b border-border bg-muted/10">
      {logs.length > 0 && <span className="text-xs font-medium text-muted-foreground mr-1">Log events:</span>}
      {logs.map(({ basis, logEvent: e }) => (
        <Link key={e.key} to={`/log-sources?event=${encodeURIComponent(e.key)}`} title={LINK_BASIS[basis]?.hint} className={cn(chip, basisChip(basis))}>
          <span className="text-muted-foreground">{e.sourceLabel}</span>
          {e.code === '*' ? 'any event' : /^\d+$/.test(e.code) ? <span className="font-mono font-semibold">{e.code}</span> : e.name}
          <BasisBadge basis={basis} />
        </Link>
      ))}
      {stories.length > 0 && <span className={cn('text-xs font-medium text-muted-foreground mr-1', logs.length > 0 && 'ml-3')}>Analytic stories:</span>}
      {stories.map(({ story }) => (
        <Link key={story.id} to={`/analytic-stories?story=${story.id}`} className={chip}>
          {story.name}
        </Link>
      ))}
    </div>
  );
}

function CollapsibleSection({
  label,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-6 py-3 hover:bg-muted/30 transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
        aria-expanded={isOpen}
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className="text-muted-foreground text-xs">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="px-6 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}


function SplCommandPanel({
  page,
  onFavoriteToggled,
}: {
  page: Page;
  onFavoriteToggled: (updated: NonNullable<Page['splCommand']>) => void;
}) {
  const spl = page.splCommand!;
  const [copying, setCopying] = useState(false);
  const [toggling, setToggling] = useState(false);

  function handleCopySyntax() {
    navigator.clipboard.writeText(spl.syntax).then(() => {
      setCopying(true);
      setTimeout(() => setCopying(false), 2000);
    });
  }

  async function handleToggleFavorite() {
    if (toggling || !spl.id) return;
    setToggling(true);
    try {
      const updated = await updateSplCommand(spl.id, { isFavorite: !spl.isFavorite });
      onFavoriteToggled({ ...spl, isFavorite: updated.isFavorite });
    } finally {
      setToggling(false);
    }
  }

  const exampleBlocks: Array<{ type: 'text' | 'code'; content: string }> = [];
  if (spl.examples) {
    const parts = spl.examples.split(/(```(?:\w+)?\n[\s\S]*?```)/g);
    for (const part of parts) {
      if (part.startsWith('```')) {
        const code = part.replace(/^```(?:\w+)?\n/, '').replace(/\n?```$/, '');
        exampleBlocks.push({ type: 'code', content: code });
      } else if (part.trim()) {
        exampleBlocks.push({ type: 'text', content: part.trim() });
      }
    }
  }

  return (
    <div className="px-6 py-5 border-b border-border bg-muted/20">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <span className="font-mono font-bold text-2xl text-foreground">{spl.command}</span>
        <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-xs font-medium">
          {spl.group}
        </span>
        <button
          onClick={handleToggleFavorite}
          disabled={toggling}
          aria-label={spl.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          title={spl.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/50 outline-none ${
            spl.isFavorite
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-600'
              : 'border-border text-muted-foreground hover:bg-accent'
          }`}
        >
          <Star className={`w-3.5 h-3.5 ${spl.isFavorite ? 'fill-current' : ''}`} />
          {spl.isFavorite ? 'Favorited' : 'Favorite'}
        </button>
      </div>

      {spl.syntax && (
        <div className="mb-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Syntax
          </div>
          <div className="relative group flex items-center">
            <pre className="flex-1 rounded-md bg-zinc-900 text-green-300 px-4 py-2.5 text-sm font-mono overflow-x-auto">
              <code>{spl.syntax}</code>
            </pre>
            <button
              onClick={handleCopySyntax}
              aria-label={copying ? 'Copied' : 'Copy syntax'}
              title={copying ? 'Copied' : 'Copy syntax'}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:text-white text-xs transition-colors opacity-0 group-hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
            >
              {copying ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copying ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {spl.description && (
        <p className="text-sm text-muted-foreground mb-3">{spl.description}</p>
      )}

      {exampleBlocks.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Examples
          </div>
          <div className="space-y-2">
            {exampleBlocks.map((block, i) =>
              block.type === 'code' ? (
                <div key={i} className="relative group">
                  <pre className="rounded-md bg-muted px-4 py-2.5 text-xs font-mono overflow-x-auto">
                    <code>{block.content}</code>
                  </pre>
                  <button
                    onClick={() => navigator.clipboard.writeText(block.content)}
                    aria-label="Copy code block"
                    title="Copy"
                    className="absolute right-2 top-2 flex items-center gap-1 px-2 py-1 rounded border border-border bg-background text-muted-foreground hover:text-foreground text-xs transition-colors opacity-0 group-hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <p key={i} className="text-sm text-foreground">{block.content}</p>
              )
            )}
          </div>
        </div>
      )}

      {spl.pitfalls && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 uppercase tracking-wide">
            Pitfall / Gotcha
          </div>
          <p className="text-sm text-amber-800 dark:text-amber-300">{spl.pitfalls}</p>
        </div>
      )}
    </div>
  );
}

function processWikiLinks(md: string, wikiLinks: Record<string, string>): string {
  return md.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
    const slug = wikiLinks[title.trim().toLowerCase()];
    if (slug) return `[${title}](/pages/${slug})`;
    const encodedTitle = encodeURIComponent(title.trim());
    return `<span class="wiki-link-broken" title="Page not found: ${title}">[${title}](/pages/new?title=${encodedTitle})</span>`;
  });
}

export function PageViewPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  async function handleExportSigma() {
    if (!page) return;
    try {
      const isSkeleton = await downloadSigmaRule(page.id, page.slug);
      if (isSkeleton) {
        toast('This rule has no Sigma source — exported a skeleton; complete its detection logic', 'info');
      }
    } catch (err) {
      toast(apiErrorMessage(err, 'Sigma export failed'), 'error');
    }
  }
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [backlinks, setBacklinks] = useState<{ id: number; title: string; slug: string; type: string }[]>([]);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setNotFound(false);
    getPage(slug)
      .then(setPage)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    getBacklinks(slug).then(setBacklinks).catch(() => setBacklinks([]));
  }, [slug]);

  async function handleDelete() {
    if (!page) return;
    setDeleting(true);
    try {
      await deletePage(page.id);
      navigate('/pages');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleTogglePin() {
    if (!page) return;
    setPinning(true);
    try {
      const updated = await updatePage(page.id, { isPinned: !page.isPinned });
      setPage((prev) => prev ? { ...prev, isPinned: updated.isPinned } : prev);
    } finally {
      setPinning(false);
    }
  }

  async function handleExportPdf() {
    if (!page) return;
    setExportingPdf(true);
    try {
      const result = await exportPageAsPDF(page.slug);
      await downloadGeneratedDoc(result.document.id, `${page.title}.pdf`);
    } catch {
      // silently fail — user can navigate to Documentation page
    } finally {
      setExportingPdf(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto" role="status" aria-label="Loading page">
        <Skeleton className="h-4 w-48 mb-6" />
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-6 py-5 border-b border-border space-y-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="px-6 py-6 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <p className="text-muted-foreground mb-4">Page not found.</p>
        <Link to="/pages" className="text-primary hover:underline text-sm">
          Back to Pages
        </Link>
      </div>
    );
  }

  const breadcrumbItems = page.type === 'RULE'
    ? [{ label: 'Detection Rules', to: '/rules' }, { label: page.title }]
    : [{ label: 'Pages', to: '/pages' }, { label: page.title }];

  const processedContent = processWikiLinks(page.contentMd, page.wikiLinks ?? {});

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumbs + header row */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <Breadcrumbs items={breadcrumbItems} />
          <h1 className="text-2xl font-semibold tracking-tight mt-1">{page.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <TypeBadge type={page.type} />
            {page.isPinned && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                Pinned
              </span>
            )}
            {page.tags.length > 0 && (
              <>
                {page.tags.map(({ tag }) => (
                  <span
                    key={tag.id}
                    className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: tag.color || '#6b7280' }}
                  >
                    {tag.name}
                  </span>
                ))}
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Updated {relativeTime(page.updatedAt)}
            {page.category && (
              <> &middot; <span className="font-medium text-foreground">{page.category.name}</span></>
            )}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExportPdf}
            disabled={exportingPdf}
            aria-label="Export as PDF"
            title="Export as PDF"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {exportingPdf ? 'Exporting…' : 'PDF'}
          </button>
          <button
            onClick={() => navigate(`/graph?view=explore&focus=page:${page.id}`)}
            aria-label="Show in knowledge graph"
            title="Show in knowledge graph"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
          >
            <Network className="w-3.5 h-3.5" />
            Graph
          </button>
          {page.type === 'RULE' && page.rule && (
            <button
              onClick={handleExportSigma}
              aria-label="Export as Sigma"
              title="Export as Sigma YAML"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
            >
              <Download className="w-3.5 h-3.5" />
              Sigma
            </button>
          )}
          {hasPermission('pages:update') && (
          <>
          <button
            onClick={() => navigate(`/pages/${page.slug}/edit`)}
            aria-label="Edit page"
            title="Edit page"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
          <button
            onClick={handleTogglePin}
            disabled={pinning}
            aria-label={page.isPinned ? 'Unpin page' : 'Pin page'}
            title={page.isPinned ? 'Unpin page' : 'Pin page'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
          >
            {page.isPinned ? (
              <PinOff className="w-3.5 h-3.5" />
            ) : (
              <Pin className="w-3.5 h-3.5" />
            )}
            {page.isPinned ? 'Unpin' : 'Pin'}
          </button>
          </>
          )}
          {hasPermission('pages:delete') && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleting}
            aria-label="Delete page"
            title="Delete page"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-destructive/50 outline-none"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
          )}
        </div>
      </div>

      <article className="rounded-lg border border-border bg-card overflow-hidden">
        {/* SPL Command structured panel */}
        {page.type === 'SPL_COMMAND' && page.splCommand && (
          <SplCommandPanel page={page} onFavoriteToggled={(updated) =>
            setPage((prev) => prev ? { ...prev, splCommand: updated } : prev)
          } />
        )}

        {/* Detection Rule structured panel */}
        {page.type === 'RULE' && page.rule && (
          <RulePanel rule={page.rule} slug={page.slug} />
        )}

        <SysmonLinksBar links={page.sysmonEvents ?? []} />
        <TelemetryBar page={page} />
        {page.type === 'RULE' && page.rule && <ReferencesBar pageId={page.id} />}

        <div className="px-6 py-6">
          {page.contentMd ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const isBlock = className?.startsWith('language-');
                    const codeText = String(children).replace(/\n$/, '');
                    if (isBlock) {
                      return (
                        <div className="relative group my-4">
                          <pre className="overflow-x-auto rounded-md bg-muted px-4 py-3 text-xs">
                            <code className={className} {...props}>
                              {children}
                            </code>
                          </pre>
                          <CopyButton text={codeText} />
                        </div>
                      );
                    }
                    return (
                      <code
                        className="rounded bg-muted px-1 py-0.5 text-xs font-mono"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  pre({ children }) {
                    return <>{children}</>;
                  },
                  a({ href, children, ...props }) {
                    if (href?.startsWith('/')) {
                      return (
                        <Link to={href} className="text-primary hover:underline" {...(props as object)}>
                          {children}
                        </Link>
                      );
                    }
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {processedContent}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm italic">No content yet.</p>
          )}
        </div>
      </article>

      {/* Backlinks panel */}
      <div className="mt-6 rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Link2 className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Backlinks</h2>
          {backlinks.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
              {backlinks.length}
            </span>
          )}
        </div>
        <div className="px-5 py-4">
          {backlinks.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No backlinks yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {backlinks.map((bl) => (
                <li key={bl.id}>
                  <Link
                    to={`/pages/${bl.slug}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {bl.title}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{bl.type}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Page"
        message={`Delete "${page.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
