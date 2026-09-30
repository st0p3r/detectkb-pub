import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Shield, ChevronDown, ChevronRight, Copy, Check, Search, Activity, Database, Loader2 } from 'lucide-react';
import { getSysmonEventPages, listSysmonEvents, type SysmonEvent, type SysmonLinkedPage } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { BasisBadge } from '@/components/ui/BasisBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';

const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Process:  { bg: 'bg-indigo-500/10',  text: 'text-indigo-400',  dot: '#6366f1' },
  Network:  { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: '#22c55e' },
  File:     { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: '#f59e0b' },
  Registry: { bg: 'bg-orange-500/10',  text: 'text-orange-400',  dot: '#f97316' },
  Driver:   { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: '#ef4444' },
  Image:    { bg: 'bg-pink-500/10',    text: 'text-pink-400',    dot: '#ec4899' },
  WMI:      { bg: 'bg-purple-500/10',  text: 'text-purple-400',  dot: '#a855f7' },
  Service:  { bg: 'bg-sky-500/10',     text: 'text-sky-400',     dot: '#0ea5e9' },
  Pipe:     { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    dot: '#06b6d4' },
  Storage:  { bg: 'bg-teal-500/10',    text: 'text-teal-400',    dot: '#14b8a6' },
};

const VALUE_COLORS: Record<string, { chip: string }> = {
  high:   { chip: 'bg-red-500/15 text-red-400 border border-red-500/20' },
  medium: { chip: 'bg-amber-500/15 text-amber-400 border border-amber-500/20' },
  low:    { chip: 'bg-slate-500/15 text-slate-400 border border-slate-500/20' },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

const LIST_LIMIT = 50;

function LinkedPageList({ title, icon: Icon, pages, empty }: {
  title: string;
  icon: React.ElementType;
  pages: SysmonLinkedPage[];
  empty?: string;
}) {
  // Event 1 alone has ~1,000 rules: show the first 50 until asked
  const [showAll, setShowAll] = useState(false);
  if (!pages.length && !empty) return null;
  const shown = showAll ? pages : pages.slice(0, LIST_LIMIT);
  return (
    <div>
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        <Icon className="w-3.5 h-3.5" /> {title} ({pages.length})
      </h4>
      {pages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-2 flex-wrap text-sm">
              <Link to={`/pages/${p.slug}`} className="text-primary hover:underline">{p.title}</Link>
              {p.status && <StatusBadge status={p.status} />}
              {p.severity && <SeverityBadge severity={p.severity} />}
              <BasisBadge basis={p.source === 'manual' ? 'manual' : p.basis} />
            </li>
          ))}
          {pages.length > shown.length && (
            <li>
              <button onClick={() => setShowAll(true)} className="text-sm text-primary hover:underline">
                Show all {pages.length.toLocaleString()}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** The pages linked to an event, fetched when its card is opened. */
function EventLinks({ eventId }: { eventId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['sysmon-event-pages', eventId],
    queryFn: () => getSysmonEventPages(eventId),
    staleTime: 30 * 1000,
  });
  if (isLoading || !data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading linked rules…
      </p>
    );
  }
  return (
    <>
      <LinkedPageList title="Detection rules using this event" icon={Shield} pages={data.rules} empty="No detection rule depends on this event yet." />
      <LinkedPageList title="Data sources" icon={Database} pages={data.dataSources} />
      <LinkedPageList title="Other pages" icon={Activity} pages={data.otherPages} />
    </>
  );
}

function EventCard({ event, index, initiallyExpanded }: { event: SysmonEvent; index: number; initiallyExpanded: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initiallyExpanded) {
      setExpanded(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [initiallyExpanded]);
  const { ruleCount, dataSourceCount } = event;
  const cat = CATEGORY_COLORS[event.category] ?? { bg: 'bg-slate-500/10', text: 'text-slate-400', dot: '#94a3b8' };
  const val = VALUE_COLORS[event.detectionValue] ?? VALUE_COLORS.medium;

  return (
    <div
      ref={ref}
      id={`event-${event.eventId}`}
      className={`bg-card rounded-xl border border-border/60 overflow-hidden transition-all duration-200 hover:border-border hover:shadow-md animate-fade-in-up stagger-${Math.min(index + 1, 6)}`}
    >
      <button
        className="w-full text-left px-5 py-4 flex items-start gap-4"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Event ID badge */}
        <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-600/20 border border-indigo-500/20 flex flex-col items-center justify-center">
          <span className="text-[10px] text-indigo-400/70 font-medium leading-none">EID</span>
          <span className="text-base font-bold text-indigo-300 leading-tight">{event.eventId}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground">{event.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cat.bg} ${cat.text}`}>
              {event.category}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${val.chip}`}>
              {event.detectionValue}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium border ${ruleCount ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-muted text-muted-foreground border-border'}`}
              title="Detection rules that depend on this event"
            >
              {ruleCount ? `${ruleCount} rule${ruleCount === 1 ? '' : 's'}` : 'no rules'}
            </span>
            {dataSourceCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-sky-500/10 text-sky-500 border border-sky-500/20">
                {dataSourceCount} data source{dataSourceCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{event.description}</p>
        </div>

        <div className="flex-shrink-0 text-muted-foreground mt-1">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/60 px-5 py-4 space-y-4 bg-muted/20">
          <EventLinks eventId={event.eventId} />

          {event.keyFields && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Key Fields</h4>
              <div className="flex flex-wrap gap-1.5">
                {event.keyFields.split(',').map((f) => f.trim()).filter(Boolean).map((field) => (
                  <span key={field} className="px-2 py-0.5 rounded-md text-xs font-mono bg-muted text-muted-foreground border border-border/40">
                    {field}
                  </span>
                ))}
              </div>
            </div>
          )}

          {event.detectionTips && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Detection Tips</h4>
              <div className="flex items-start gap-2">
                <p className="text-sm text-foreground/80 flex-1">{event.detectionTips}</p>
                <CopyButton text={event.detectionTips} />
              </div>
            </div>
          )}

          {event.attackPatterns && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">MITRE ATT&CK</h4>
              <div className="flex flex-wrap gap-1.5">
                {event.attackPatterns.split(',').map((t) => t.trim()).filter(Boolean).map((tech) => (
                  <span key={tech} className="px-2 py-0.5 rounded-md text-xs font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20">
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type CoverageFilter = 'all' | 'covered' | 'uncovered';

export function SysmonEventsPage() {
  const [searchParams] = useSearchParams();
  const focusEvent = Number(searchParams.get('event')) || null;
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageFilter>('all');

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['sysmon-events'],
    queryFn: () => listSysmonEvents(),
    staleTime: 30 * 1000,
  });
  const coveredCount = events.filter((e) => e.ruleCount > 0).length;

  const categories = Array.from(new Set(events.map((e) => e.category))).sort();

  const filtered = events.filter((e) => {
    const matchCat = !activeCategory || e.category === activeCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || (e.attackPatterns ?? '').toLowerCase().includes(q) || (e.detectionTips ?? '').toLowerCase().includes(q);
    const matchCoverage =
      coverage === 'all' || (coverage === 'covered' ? e.ruleCount > 0 : e.ruleCount === 0);
    return matchCat && matchSearch && matchCoverage;
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 animate-fade-in-up">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-900/30">
          <Activity className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sysmon Event IDs</h1>
          <p className="text-muted-foreground text-sm">
            Categories, detection tips, MITRE mappings — and which of your rules and data sources depend on each event
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-sm font-medium border border-indigo-500/20">
            {filtered.length} / {events.length} events
          </span>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 animate-fade-in-up stagger-1">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search events, techniques, tips..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
        </div>
        <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium" role="group" aria-label="Rule coverage">
          {([
            ['all', 'All'],
            ['covered', `With rules (${coveredCount})`],
            ['uncovered', `No rules (${events.length - coveredCount})`],
          ] as [CoverageFilter, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setCoverage(key)}
              aria-pressed={coverage === key}
              className={`px-3 py-2 rounded-md transition-colors ${coverage === key ? 'bg-indigo-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2 animate-fade-in-up stagger-2">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${!activeCategory ? 'bg-indigo-600 text-white shadow-sm' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}
        >
          All Categories
        </button>
        {categories.map((cat) => {
          const c = CATEGORY_COLORS[cat] ?? { bg: 'bg-slate-500/10', text: 'text-slate-400', dot: '#94a3b8' };
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(isActive ? null : cat)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${isActive ? `${c.bg} ${c.text} border-current/30` : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.dot }} />
              {cat}
            </button>
          );
        })}
      </div>

      {/* Events list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Shield className="w-5 h-5 animate-pulse" />
            <span>Loading Sysmon events...</span>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No events match your search</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((event, i) => (
            <EventCard key={event.id} event={event} index={i} initiallyExpanded={event.eventId === focusEvent} />
          ))}
        </div>
      )}
    </div>
  );
}
