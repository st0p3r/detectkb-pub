import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Compass, GitBranch, Network, Share2 } from 'lucide-react';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { cn } from '@/lib/utils';
import { WikiView } from './WikiView';
import { ExploreView } from './ExploreView';
import { ChainView } from './ChainView';

type View = 'wiki' | 'explore' | 'chain';

const VIEWS: { id: View; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'wiki', label: 'Wiki', icon: Share2, hint: 'Knowledge pages and their [[links]]' },
  { id: 'explore', label: 'Explore', icon: Compass, hint: 'Start from one node and expand step by step' },
  { id: 'chain', label: 'Detection chain', icon: GitBranch, hint: 'Tactic → technique → rules → Sysmon events → data sources' },
];

/** Knowledge graph with three views; the view and its focus live in the URL. */
export default function KnowledgeGraphPage() {
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'wiki') as View;
  const focus = params.get('focus');
  const technique = params.get('technique') ?? 'T1003';

  const go = (next: Record<string, string>) => setParams(next);

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <Breadcrumbs items={[{ label: 'Knowledge Graph' }]} />
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Network className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Graph</h1>
        <div className="flex rounded-lg border border-border bg-card p-0.5 ml-2" role="tablist">
          {VIEWS.map(({ id, label, icon: Icon, hint }) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              title={hint}
              onClick={() => go(id === 'explore' && focus ? { view: id, focus } : id === 'chain' ? { view: id, technique } : { view: id })}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                view === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{VIEWS.find((v) => v.id === view)?.hint}</span>
      </div>

      {view === 'wiki' && <WikiView onExplore={(id) => go({ view: 'explore', focus: id })} />}
      {view === 'explore' && (
        <ExploreView
          focusId={focus}
          onFocusChange={(id) => go(id ? { view: 'explore', focus: id } : { view: 'explore' })}
          onShowChain={(t) => go({ view: 'chain', technique: t })}
        />
      )}
      {view === 'chain' && <ChainView technique={technique} onTechniqueChange={(t) => go({ view: 'chain', technique: t })} />}
    </div>
  );
}
