import attackData from '../data/attack-enterprise.json';

// Compact MITRE ATT&CK Enterprise dataset, regenerate with
// `node scripts/update-attack-data.js`.

export interface AttackTactic {
  id: string; // TA0002
  shortname: string; // execution
  name: string; // Execution
}

export interface AttackTechnique {
  id: string; // T1059 or T1059.001
  name: string;
  tactics: string[]; // tactic shortnames
}

export const ATTACK_VERSION: string | null = attackData.version;
export const TACTICS: AttackTactic[] = attackData.tactics;
export const TECHNIQUES: AttackTechnique[] = attackData.techniques;
/** Revoked technique ID → the current technique that replaced it. */
export const REVOKED_TECHNIQUES: Record<string, string> = attackData.revoked;

export const TECHNIQUE_BY_ID = new Map(TECHNIQUES.map((t) => [t.id, t]));
const TACTIC_BY_KEY = new Map<string, AttackTactic>();
for (const t of TACTICS) {
  TACTIC_BY_KEY.set(t.id.toLowerCase(), t);
  TACTIC_BY_KEY.set(t.shortname, t);
  TACTIC_BY_KEY.set(t.name.toLowerCase(), t);
  // Sigma uses underscores in older rules: attack.credential_access
  TACTIC_BY_KEY.set(t.shortname.replace(/-/g, '_'), t);
}
// Names retired by newer ATT&CK releases but still used by most Sigma rules
const LEGACY_TACTIC_NAMES: Record<string, string> = {
  'defense-evasion': 'TA0005', // renamed to "Stealth" in ATT&CK v19
};
for (const [name, id] of Object.entries(LEGACY_TACTIC_NAMES)) {
  const tactic = TACTIC_BY_KEY.get(id.toLowerCase());
  if (!tactic) continue;
  for (const key of [name, name.replace(/-/g, '_'), name.replace(/-/g, ' ')]) {
    if (!TACTIC_BY_KEY.has(key)) TACTIC_BY_KEY.set(key, tactic);
  }
}

/** Extracts technique IDs (T1059, T1059.001) from free text such as "T1110, t1110.001". */
export function parseTechniqueIds(text: string | null | undefined): string[] {
  if (!text) return [];
  const ids = text.toUpperCase().match(/\bT\d{4}(?:\.\d{3})?\b/g) ?? [];
  return Array.from(new Set(ids));
}

/** Resolves a tactic from its ID (TA0002), shortname (execution / credential_access) or name. */
export function findTactic(key: string): AttackTactic | undefined {
  return TACTIC_BY_KEY.get(key.trim().toLowerCase());
}

/**
 * Maps a technique ID onto the current matrix: returns the ID itself when it is
 * current, its replacement when MITRE revoked it, or null when it is unknown
 * (deprecated without replacement, or a typo).
 */
export function resolveTechniqueId(id: string): string | null {
  if (TECHNIQUE_BY_ID.has(id)) return id;
  const replacement = REVOKED_TECHNIQUES[id];
  return replacement && TECHNIQUE_BY_ID.has(replacement) ? replacement : null;
}

/**
 * Replaces technique IDs MITRE retired (and gave a replacement) in a rule's
 * technique field. A plain list ("T1562, T1562.004") is rebuilt without
 * duplicates; other text keeps its wording with the IDs swapped.
 */
export function replaceRetiredTechniques(text: string | null): { text: string | null; replaced: [string, string][] } {
  if (!text) return { text, replaced: [] };
  const replaced: [string, string][] = [];
  const swap = (id: string) => {
    const upper = id.toUpperCase();
    if (TECHNIQUE_BY_ID.has(upper)) return upper;
    const to = resolveTechniqueId(upper);
    if (!to) return id;
    if (!replaced.some(([from]) => from === upper)) replaced.push([upper, to]);
    return to;
  };
  if (/^[\sT\d.,;]+$/i.test(text)) {
    const ids = Array.from(new Set((text.match(/T\d{4}(?:\.\d{3})?/gi) ?? []).map(swap)));
    return { text: replaced.length ? ids.join(', ') : text, replaced };
  }
  const out = text.replace(/\bT\d{4}(?:\.\d{3})?\b/gi, swap);
  return { text: replaced.length ? out : text, replaced };
}

export function parentTechniqueId(id: string): string {
  return id.split('.')[0];
}
