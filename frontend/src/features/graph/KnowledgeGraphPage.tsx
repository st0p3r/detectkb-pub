import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Compass, GitBranch, Network, Route, Share2, ShieldAlert, Unplug, Waves } from 'lucide-react';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { cn } from '@/lib/utils';
import { WikiView } from './WikiView';
import { ExploreView } from './ExploreView';
import { ChainView } from './ChainView';
import { PathView } from './PathView';
import { ImpactView } from './ImpactView';
import { FlowsView } from './FlowsView';
import { GapsView } from './GapsView';
import { SaveViewButton } from '@/features/views/SaveViewButton';
import { ExportMenu } from './ExportMenu';

type View = 'wiki' | 'explore' | 'chain' | 'paths' | 'impact' | 'flows' | 'gaps';

const VIEWS: { id: View; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'wiki', label: 'Wiki', icon: Share2, hint: 'Knowledge pages and their [[links]]' },
  { id: 'explore', label: 'Explore', icon: Compass, hint: 'Start from one node and expand step by step' },
  { id: 'chain', label: 'Detection chain', icon: GitBranch, hint: 'Tactic → technique → rules → Sysmon events → data sources' },
  { id: 'paths', label: 'Paths', icon: Route, hint: 'How two nodes are connected' },
  { id: 'impact', label: 'Impact', icon: Unplug, hint: 'What stops working if a data source is lost' },
  { id: 'flows', label: 'Flows', icon: Waves, hint: 'Which telemetry feeds detections for each tactic' },
  { id: 'gaps', label: 'Tool gaps', icon: ShieldAlert, hint: 'Attacker tools and techniques no rule covers' },
];

/** Knowledge graph with three views; the view and its focus live in the URL. */
export default function KnowledgeGraphPage() {
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'wiki') as View;
  const focus = params.get('focus');
  const technique = params.get('technique') ?? 'T1003';

  const go = (next: Record<string, string>) => setParams(next);
  const list = (key: string) => (params.get(key) ?? '').split(',').filter(Boolean);
  const explore = (id: string) => go({ view: 'explore', focus: id });
  const showChain = (t: string) => go({ view: 'chain', technique: t });

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <Breadcrumbs items={[{ label: 'Knowledge Graph' }]} />
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Network className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Graph</h1>
        <div className="flex flex-wrap rounded-lg border border-border bg-card p-0.5 ml-2" role="tablist">
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
        <span className="text-sm text-muted-foreground hidden 2xl:inline">{VIEWS.find((v) => v.id === view)?.hint}</span>
        <div className="ml-auto flex items-center gap-2">
          <ExportMenu view={view} vector={view === 'flows'} />
          <SaveViewButton suggestedName={`Graph · ${VIEWS.find((v) => v.id === view)?.label}${focus ? ` · ${focus.split(':').slice(1).join(':')}` : ''}`} />
        </div>
      </div>

      {view === 'wiki' && <WikiView onExplore={explore} />}
      {view === 'explore' && (
        <ExploreView
          focusId={focus}
          onFocusChange={(id) => go(id ? { view: 'explore', focus: id } : { view: 'explore' })}
          onShowChain={showChain}
          onFindPaths={(id) => go({ view: 'paths', from: id })}
        />
      )}
      {view === 'chain' && <ChainView technique={technique} onTechniqueChange={showChain} />}
      {view === 'paths' && (
        <PathView
          from={params.get('from')}
          to={params.get('to')}
          onChange={(from, to) => go({ view: 'paths', ...(from ? { from } : {}), ...(to ? { to } : {}) })}
          onExplore={explore}
        />
      )}
      {view === 'impact' && (
        <ImpactView
          events={list('sysmon').map(Number)}
          dataSource={Number(params.get('dataSource')) || null}
          onChange={(events, ds) =>
            go({ view: 'impact', ...(events.length ? { sysmon: events.join(',') } : {}), ...(ds ? { dataSource: String(ds) } : {}) })
          }
          onShowChain={showChain}
        />
      )}
      {view === 'flows' && (
        <FlowsView
          tactic={params.get('tactic')}
          onTacticChange={(t) => go(t ? { view: 'flows', tactic: t } : { view: 'flows' })}
          onShowImpact={(eventId) => go({ view: 'impact', sysmon: String(eventId) })}
          onShowChain={showChain}
        />
      )}
      {view === 'gaps' && <GapsView onExplore={explore} />}
    </div>
  );
}
