import detailsData from '../data/attack-details.json';

// What MITRE says about each technique beyond its name: a description, and
// its detection strategy — analytics per platform, each with the log sources
// it reads and the parts meant to be tuned. Bundled like the rest of the
// ATT&CK data and replaced by an in-app ATT&CK update (lib/attack-update.ts).

export interface AttackAnalytic {
  id: string; // AN0061
  platforms: string[];
  description: string;
  /** e.g. { name: "WinEventLog:Sysmon", channel: "EventCode=1", component: "Process Creation" } */
  logSources: { name: string; channel: string; component: string }[];
  /** Thresholds, allowlists and time windows MITRE expects you to adapt */
  tunables: { field: string; description: string }[];
}

export interface DetectionStrategy {
  id: string; // DET0021
  name: string;
  analytics: AttackAnalytic[];
}

export interface TechniqueDetail {
  description: string;
  detection?: DetectionStrategy[];
  /** Free-text detection guidance of ATT&CK releases without detection strategies */
  detectionText?: string;
}

export const TECHNIQUE_DETAILS = new Map<string, TechniqueDetail>();

/** Replaces the details (startup, in-app ATT&CK update). `undefined`: the dataset has none. */
export function setAttackDetails(details: Record<string, TechniqueDetail> | undefined) {
  TECHNIQUE_DETAILS.clear();
  for (const [id, d] of Object.entries(details ?? {})) TECHNIQUE_DETAILS.set(id, d);
}
setAttackDetails(detailsData.details as Record<string, TechniqueDetail>);

export const BUNDLED_DETAILS = detailsData.details as Record<string, TechniqueDetail>;

/** A technique's analytics, limited to the given platforms when a filter is set. */
export function analyticsFor(id: string, platforms?: ReadonlySet<string> | null): AttackAnalytic[] {
  const all = (TECHNIQUE_DETAILS.get(id)?.detection ?? []).flatMap((d) => d.analytics);
  if (!platforms?.size) return all;
  return all.filter((a) => !a.platforms.length || a.platforms.some((p) => platforms.has(p)));
}
