import { useEffect } from 'react';

const APP = 'DetectKB';

/** Sets the browser tab's title to "<title> · DetectKB" while the component is shown. */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · ${APP}`;
  }, [title]);
}

// Tab titles by path, for pages that don't set their own (longest prefix wins)
const ROUTE_TITLES: [string, string][] = [
  ['/settings/users', 'Users'],
  ['/settings/tags', 'Tags'],
  ['/settings/types', 'Page types'],
  ['/pages/new', 'New page'],
  ['/attack-coverage', 'ATT&CK Coverage'],
  ['/attacker-tools', 'Attacker Tools'],
  ['/analytic-stories', 'Analytic Stories'],
  ['/atomic-tests', 'Atomic Red Team'],
  ['/broken-links', 'Broken Links'],
  ['/data-health', 'Data Health'],
  ['/data-sources', 'Data Sources'],
  ['/log-sources', 'Log Sources'],
  ['/similar-rules', 'Similar Rules'],
  ['/spl-library', 'SPL Library'],
  ['/sysmon-events', 'Sysmon Events'],
  ['/threat-groups', 'Threat Groups'],
  ['/activity', 'Activity'],
  ['/backups', 'Backups'],
  ['/concepts', 'Concepts'],
  ['/docs', 'Documentation'],
  ['/graph', 'Knowledge Graph'],
  ['/pages', 'All Pages'],
  ['/rules', 'Detection Rules'],
  ['/search', 'Search'],
  ['/settings', 'Settings'],
  ['/upstream', 'Upstream Updates'],
];

/** The tab title for a path; pages showing one item (a rule, a runbook) refine it themselves. */
export function routeTitle(pathname: string): string {
  if (pathname === '/') return `Dashboard · ${APP}`;
  const match = ROUTE_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match ? `${match[1]} · ${APP}` : APP;
}
