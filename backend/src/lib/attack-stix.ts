import type { AttackTactic, AttackTechnique } from './attack';
import type { TechniqueDetail } from './attack-details';
import type { AttackGroup, AttackMitigation, AttackSoftware } from './attack-cti';

// Converts MITRE's ATT&CK Enterprise STIX 2.1 bundle (enterprise-attack.json,
// github.com/mitre-attack/attack-stix-data) into the compact dataset DetectKB
// uses: tactics, techniques (with platforms), revoked IDs, groups, software,
// mitigations, and per technique its description and MITRE's detection
// strategy (the analytics and the log sources each one reads).
// Used by scripts/update-attack-data.js and by the in-app update.

export interface AttackDataset {
  version: string | null;
  tactics: AttackTactic[];
  techniques: AttackTechnique[];
  /** Revoked technique ID → the current technique that replaced it */
  revoked: Record<string, string>;
  groups: AttackGroup[];
  software: AttackSoftware[];
  mitigations: AttackMitigation[];
  /**
   * Technique ID → description and detection guidance. Missing in datasets
   * imported by DetectKB versions that didn't keep them.
   */
  details?: Record<string, TechniqueDetail>;
}

interface StixObject {
  id: string;
  type: string;
  name?: string;
  description?: string;
  revoked?: boolean;
  x_mitre_deprecated?: boolean;
  x_mitre_version?: string;
  x_mitre_shortname?: string;
  x_mitre_aliases?: string[];
  x_mitre_platforms?: string[];
  aliases?: string[];
  tactic_refs?: string[];
  kill_chain_phases?: { kill_chain_name: string; phase_name: string }[];
  external_references?: { source_name: string; external_id?: string }[];
  relationship_type?: string;
  source_ref?: string;
  target_ref?: string;
  x_mitre_analytic_refs?: string[];
  x_mitre_log_source_references?: { x_mitre_data_component_ref?: string; name?: string; channel?: string }[];
  x_mitre_mutable_elements?: { field?: string; description?: string }[];
  /** Technique detection text of ATT&CK releases before detection strategies (v17 and older) */
  x_mitre_detection?: string;
}

const externalId = (o: StixObject | undefined) => o?.external_references?.find((r) => r.source_name === 'mitre-attack')?.external_id;
const active = (o: StixObject) => !o.revoked && !o.x_mitre_deprecated;
const byIdOrder = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, 'en', { numeric: true });

/** First sentences of a STIX description, without citations and markdown links. */
export function summary(text: string | undefined, max = 420): string {
  const clean = (text || '')
    .replace(/\(Citation:[^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<\/?code>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = cut.lastIndexOf('. ');
  return end > max / 3 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/** Throws when the bundle isn't an ATT&CK Enterprise bundle. */
export function convertStixBundle(bundle: unknown): AttackDataset {
  const objects = (bundle as { objects?: unknown })?.objects;
  if (!Array.isArray(objects)) throw new Error('Not a STIX bundle (no "objects" list)');
  const all = objects as StixObject[];

  const matrix = all.find((o) => o.type === 'x-mitre-matrix' && active(o) && externalId(o) === 'enterprise-attack');
  if (!matrix?.tactic_refs) throw new Error('Not the ATT&CK Enterprise bundle (enterprise-attack.json): no Enterprise matrix in it');
  const collection = all.find((o) => o.type === 'x-mitre-collection');
  const tacticsById = new Map(all.filter((o) => o.type === 'x-mitre-tactic' && active(o)).map((o) => [o.id, o]));
  const tactics: AttackTactic[] = matrix.tactic_refs
    .map((ref) => tacticsById.get(ref))
    .filter((t): t is StixObject => !!t && !!externalId(t) && !!t.x_mitre_shortname)
    .map((t) => ({ id: externalId(t)!, shortname: t.x_mitre_shortname!, name: t.name ?? '' }));

  const techniques: AttackTechnique[] = all
    .filter((o) => o.type === 'attack-pattern' && active(o) && externalId(o))
    .map((o) => ({
      id: externalId(o)!,
      name: o.name ?? '',
      tactics: (o.kill_chain_phases || []).filter((p) => p.kill_chain_name === 'mitre-attack').map((p) => p.phase_name),
      platforms: o.x_mitre_platforms || [],
    }))
    .sort(byIdOrder);
  if (!techniques.length) throw new Error('The bundle has no techniques');

  // Revoked technique IDs → the technique that replaced them (e.g. T1562.001 → T1685),
  // so rules written against older ATT&CK releases still map onto the current matrix.
  const byStixId = new Map(all.map((o) => [o.id, o]));
  const revoked: Record<string, string> = {};
  for (const rel of all) {
    if (rel.type !== 'relationship' || rel.relationship_type !== 'revoked-by') continue;
    const from = byStixId.get(rel.source_ref ?? '');
    const to = byStixId.get(rel.target_ref ?? '');
    if (from?.type !== 'attack-pattern' || !to || !active(to)) continue;
    const fromId = externalId(from);
    const toId = externalId(to);
    if (fromId && toId && fromId !== toId) revoked[fromId] = toId;
  }

  // Threat groups, software (malware and tools) and mitigations, with the
  // techniques they use / mitigate. Revoked and deprecated objects are left out.
  const techniqueIds = new Set(techniques.map((t) => t.id));
  const uses = new Map<string, Set<string>>();
  const mitigates = new Map<string, Set<string>>();
  const addRel = (map: Map<string, Set<string>>, from: string, to: string) => {
    if (!map.has(from)) map.set(from, new Set());
    map.get(from)!.add(to);
  };
  for (const rel of all) {
    if (rel.type !== 'relationship' || rel.revoked || rel.x_mitre_deprecated || !rel.source_ref || !rel.target_ref) continue;
    if (rel.relationship_type === 'uses') addRel(uses, rel.source_ref, rel.target_ref);
    if (rel.relationship_type === 'mitigates') addRel(mitigates, rel.source_ref, rel.target_ref);
  }
  const targets = (map: Map<string, Set<string>>, obj: StixObject, types: string[]) =>
    Array.from(map.get(obj.id) || [])
      .map((ref) => byStixId.get(ref))
      .filter((t): t is StixObject => !!t && active(t) && types.includes(t.type))
      .map(externalId)
      .filter((id): id is string => !!id);
  const techniquesOf = (map: Map<string, Set<string>>, obj: StixObject) =>
    Array.from(new Set(targets(map, obj, ['attack-pattern']).filter((id) => techniqueIds.has(id)))).sort((a, b) =>
      a.localeCompare(b, 'en', { numeric: true })
    );

  const groups: AttackGroup[] = all
    .filter((o) => o.type === 'intrusion-set' && active(o) && externalId(o))
    .map((o) => ({
      id: externalId(o)!,
      name: o.name ?? '',
      aliases: (o.aliases || []).filter((a) => a !== o.name),
      description: summary(o.description),
      techniques: techniquesOf(uses, o),
      software: Array.from(new Set(targets(uses, o, ['malware', 'tool']))).sort(),
    }))
    .sort(byIdOrder);
  const software: AttackSoftware[] = all
    .filter((o) => (o.type === 'malware' || o.type === 'tool') && active(o) && externalId(o))
    .map((o) => ({
      id: externalId(o)!,
      name: o.name ?? '',
      type: o.type as 'malware' | 'tool',
      aliases: (o.x_mitre_aliases || []).filter((a) => a !== o.name),
      platforms: o.x_mitre_platforms || [],
      description: summary(o.description),
      techniques: techniquesOf(uses, o),
    }))
    .sort(byIdOrder);
  const mitigations: AttackMitigation[] = all
    .filter((o) => o.type === 'course-of-action' && active(o) && /^M\d{4}$/.test(externalId(o) || ''))
    .map((o) => ({ id: externalId(o)!, name: o.name ?? '', description: summary(o.description), techniques: techniquesOf(mitigates, o) }))
    .sort(byIdOrder);

  // Detection strategies (ATT&CK v18+): strategy —detects→ technique, each
  // strategy listing analytics per platform with the log sources they read.
  const detects = new Map<string, StixObject[]>();
  for (const rel of all) {
    if (rel.type !== 'relationship' || rel.relationship_type !== 'detects' || rel.revoked || rel.x_mitre_deprecated) continue;
    const strategy = byStixId.get(rel.source_ref ?? '');
    const technique = byStixId.get(rel.target_ref ?? '');
    if (strategy?.type !== 'x-mitre-detection-strategy' || !active(strategy) || !technique) continue;
    detects.set(technique.id, [...(detects.get(technique.id) ?? []), strategy]);
  }
  const text = (t: string | undefined) => summary(t, 2000);
  const details: Record<string, TechniqueDetail> = {};
  for (const o of all) {
    if (o.type !== 'attack-pattern' || !active(o)) continue;
    const id = externalId(o);
    if (!id) continue;
    const detection = (detects.get(o.id) ?? [])
      .map((st) => ({
        id: externalId(st) ?? '',
        name: st.name ?? '',
        analytics: (st.x_mitre_analytic_refs ?? [])
          .map((ref) => byStixId.get(ref))
          .filter((a): a is StixObject => !!a && active(a))
          .map((a) => ({
            id: externalId(a) ?? '',
            platforms: a.x_mitre_platforms || [],
            description: text(a.description),
            logSources: (a.x_mitre_log_source_references ?? []).map((l) => ({
              name: l.name ?? '',
              channel: l.channel ?? '',
              component: byStixId.get(l.x_mitre_data_component_ref ?? '')?.name ?? '',
            })),
            tunables: (a.x_mitre_mutable_elements ?? []).filter((m) => m.field).map((m) => ({ field: m.field!, description: m.description ?? '' })),
          }))
          .sort(byIdOrder),
      }))
      .sort(byIdOrder);
    details[id] = {
      description: summary(o.description, 900),
      ...(detection.length && { detection }),
      // Older releases: free text on the technique itself
      ...(!detection.length && o.x_mitre_detection && { detectionText: text(o.x_mitre_detection) }),
    };
  }

  return { version: collection?.x_mitre_version ?? null, tactics, techniques, revoked, groups, software, mitigations, details };
}
