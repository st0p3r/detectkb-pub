import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Terminal, Star, Copy, Check, ChevronDown, ChevronUp, Plus, Zap } from 'lucide-react';
import {
  listSplCommands,
  updateSplCommand,
  seedSplLibrary,
  type SplCommandWithPage,
} from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';

type Density = 'comfortable' | 'compact';

const ALL_GROUPS = ['Search', 'Reporting', 'Eval functions', 'Filtering', 'Transforming'];

function CopySyntaxButton({ syntax }: { syntax: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(syntax).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy syntax"
      className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

interface SplCardProps {
  cmd: SplCommandWithPage;
  density: Density;
  onToggleFavorite: (id: number, current: boolean) => void;
}

function SplCard({ cmd, density, onToggleFavorite }: SplCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border border-border bg-card transition-shadow hover:shadow-sm ${
        density === 'compact' ? 'px-4 py-2.5' : 'px-5 py-4'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Command name */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-mono font-bold text-foreground ${
                density === 'comfortable' ? 'text-base' : 'text-sm'
              }`}
            >
              {cmd.command}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
              {cmd.group}
            </span>
          </div>

          {/* Syntax */}
          <div
            className={`font-mono text-xs text-muted-foreground mt-1 truncate ${
              density === 'compact' ? 'max-w-lg' : ''
            }`}
          >
            {cmd.syntax}
          </div>

          {/* Description — comfortable mode only */}
          {density === 'comfortable' && cmd.description && (
            <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{cmd.description}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <CopySyntaxButton syntax={cmd.syntax} />
          <button
            onClick={() => onToggleFavorite(cmd.id!, cmd.isFavorite)}
            title={cmd.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            className={`p-1.5 rounded transition-colors ${
              cmd.isFavorite
                ? 'text-amber-500 hover:text-amber-400'
                : 'text-muted-foreground hover:text-amber-500'
            }`}
          >
            <Star className={`w-4 h-4 ${cmd.isFavorite ? 'fill-current' : ''}`} />
          </button>
          <Link
            to={`/pages/${cmd.page.slug}`}
            title="View page"
            className="p-1.5 rounded text-muted-foreground hover:text-primary transition-colors text-xs font-medium"
          >
            View
          </Link>
          {density === 'comfortable' && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
              title={expanded ? 'Collapse' : 'Expand examples & pitfalls'}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded section */}
      {density === 'comfortable' && expanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-3">
          {cmd.examples && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Examples
              </h4>
              <div className="text-sm text-foreground space-y-2">
                {cmd.examples.split('\n').map((line, i) => {
                  if (line.startsWith('```')) return null;
                  if (line.trim() === '') return null;
                  return (
                    <p key={i} className="text-sm leading-relaxed">
                      {line}
                    </p>
                  );
                })}
                {/* Code blocks */}
                {(() => {
                  const blocks: string[] = [];
                  const parts = cmd.examples.split(/```(?:\w+)?\n?/);
                  for (let i = 1; i < parts.length; i += 2) {
                    if (parts[i]) blocks.push(parts[i].replace(/\n?$/, ''));
                  }
                  return blocks.map((block, bi) => (
                    <div key={bi} className="relative group">
                      <pre className="rounded-md bg-muted px-3 py-2 text-xs font-mono overflow-x-auto">
                        <code>{block}</code>
                      </pre>
                      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <CopySyntaxButton syntax={block} />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
          {cmd.pitfalls && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
              <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 uppercase tracking-wide">
                Pitfall
              </h4>
              <p className="text-xs text-amber-800 dark:text-amber-300">{cmd.pitfalls}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SplLibraryPage() {
  const [commands, setCommands] = useState<SplCommandWithPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');

  const [density, setDensity] = useState<Density>('comfortable');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  function fetchCommands() {
    setLoading(true);
    listSplCommands()
      .then(setCommands)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchCommands();
  }, []);

  async function handleSeed() {
    setSeeding(true);
    setSeedMsg('');
    try {
      const result = await seedSplLibrary();
      setSeedMsg(`Seeded ${result.seeded} command(s).`);
      fetchCommands();
    } catch {
      setSeedMsg('Seed failed.');
    } finally {
      setSeeding(false);
    }
  }

  async function handleToggleFavorite(id: number, current: boolean) {
    const updated = await updateSplCommand(id, { isFavorite: !current });
    setCommands((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isFavorite: updated.isFavorite } : c))
    );
  }

  const filtered = useMemo(() => {
    let result = commands;

    if (favoritesOnly) {
      result = result.filter((c) => c.isFavorite);
    }

    if (activeGroup) {
      result = result.filter((c) => c.group === activeGroup);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.command.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q)
      );
    }

    return result;
  }, [commands, favoritesOnly, activeGroup, searchQuery]);

  // Group by group name
  const grouped = useMemo(() => {
    const map = new Map<string, SplCommandWithPage[]>();
    for (const cmd of filtered) {
      const g = cmd.group || 'Other';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(cmd);
    }
    return map;
  }, [filtered]);

  return (
    <div className="max-w-5xl mx-auto">
      <Breadcrumbs items={[{ label: 'SPL Library' }]} />
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Terminal className="w-6 h-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">SPL Library</h1>
          {commands.length > 0 && (
            <span className="text-sm text-muted-foreground">({commands.length} commands)</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Density toggle */}
          <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
            <button
              onClick={() => setDensity('comfortable')}
              className={`px-3 py-1.5 transition-colors ${
                density === 'comfortable'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              }`}
            >
              Comfortable
            </button>
            <button
              onClick={() => setDensity('compact')}
              className={`px-3 py-1.5 border-l border-border transition-colors ${
                density === 'compact'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              }`}
            >
              Compact
            </button>
          </div>

          {/* Seed button */}
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
            {seeding ? 'Seeding…' : 'Seed Library'}
          </button>

          {/* Add Command button */}
          <Link
            to="/pages/new?type=SPL_COMMAND"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Command
          </Link>
        </div>
      </div>

      {/* Seed message */}
      {seedMsg && (
        <div className="mb-4 px-4 py-2 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 text-sm">
          {seedMsg}
        </div>
      )}

      {/* Search bar */}
      <div className="mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search commands by name or description…"
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Filter bar */}
      <div className="mb-5 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { setActiveGroup(null); setFavoritesOnly(false); }}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
            !activeGroup && !favoritesOnly
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:bg-accent'
          }`}
        >
          All Groups
        </button>

        {ALL_GROUPS.map((g) => (
          <button
            key={g}
            onClick={() => { setActiveGroup(g === activeGroup ? null : g); setFavoritesOnly(false); }}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              activeGroup === g
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            {g}
          </button>
        ))}

        {/* Favorites toggle */}
        <button
          onClick={() => { setFavoritesOnly((f) => !f); setActiveGroup(null); }}
          className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
            favoritesOnly
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-600'
              : 'border-border text-muted-foreground hover:bg-accent'
          }`}
        >
          <Star className={`w-3 h-3 ${favoritesOnly ? 'fill-current' : ''}`} />
          Favorites
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <Terminal className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {commands.length === 0
              ? 'No commands yet. Click "Seed Library" to populate with 15 starter commands.'
              : 'No commands match your search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([group, cmds]) => (
            <section key={group}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">
                {group}
                <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground/60">
                  ({cmds.length})
                </span>
              </h2>
              <div className={`space-y-${density === 'compact' ? '1.5' : '2'}`}>
                {cmds.map((cmd) => (
                  <SplCard
                    key={cmd.id}
                    cmd={cmd}
                    density={density}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
