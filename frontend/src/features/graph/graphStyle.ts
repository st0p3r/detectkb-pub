// Colours and labels for graph node groups. Page nodes use their page-type colour.
export const ENTITY_GROUPS: Record<string, { label: string; color: string }> = {
  technique: { label: 'ATT&CK techniques', color: '#8b5cf6' },
  sysmon: { label: 'Sysmon events', color: '#6366f1' },
  lolbas: { label: 'LOLBAS', color: '#f97316' },
  gtfobins: { label: 'GTFOBins', color: '#16a34a' },
  loldrivers: { label: 'LOLDrivers', color: '#dc2626' },
  category: { label: 'Categories', color: '#14b8a6' },
  tag: { label: 'Tags', color: '#94a3b8' },
  more: { label: 'More', color: '#94a3b8' },
};

export const isPageGroup = (group: string) => !(group in ENTITY_GROUPS);

export const TOOL_GROUPS = ['lolbas', 'gtfobins', 'loldrivers'];

/** Reads a shadcn colour variable ("222 47% 11%") as a CSS colour. */
export function cssColor(variable: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v ? `hsl(${v})` : fallback;
}
