import ctiData from '../data/attack-cti.json';
import { TECHNIQUE_BY_ID, parentTechniqueId } from './attack';

// ATT&CK threat groups, software (malware and tools) and mitigations, with the
// techniques they use / mitigate. Regenerate with
// `node scripts/update-attack-data.js` (together with attack-enterprise.json).

export interface AttackGroup {
  id: string; // G0049
  name: string;
  aliases: string[];
  description: string;
  techniques: string[];
  software: string[];
}

export interface AttackSoftware {
  id: string; // S0002
  name: string;
  type: 'malware' | 'tool';
  aliases: string[];
  platforms: string[];
  description: string;
  techniques: string[];
}

export interface AttackMitigation {
  id: string; // M1026
  name: string;
  description: string;
  techniques: string[];
}

export const GROUPS = ctiData.groups as AttackGroup[];
export const SOFTWARE = ctiData.software as AttackSoftware[];
export const MITIGATIONS = ctiData.mitigations as AttackMitigation[];

export const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]));
export const SOFTWARE_BY_ID = new Map(SOFTWARE.map((s) => [s.id, s]));
export const MITIGATION_BY_ID = new Map(MITIGATIONS.map((m) => [m.id, m]));

function index<T extends { techniques: string[] }>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) for (const t of item.techniques) out.set(t, [...(out.get(t) ?? []), item]);
  return out;
}
/** technique ID → groups / software / mitigations that list it */
export const GROUPS_BY_TECHNIQUE = index(GROUPS);
export const SOFTWARE_BY_TECHNIQUE = index(SOFTWARE);
export const MITIGATIONS_BY_TECHNIQUE = index(MITIGATIONS);

export const attackObjectUrl = (id: string) => {
  const kind = id[0] === 'G' ? 'groups' : id[0] === 'S' ? 'software' : id[0] === 'M' ? 'mitigations' : 'techniques';
  return `https://attack.mitre.org/${kind}/${id.replace('.', '/')}/`;
};

export type TechniqueState = 'covered' | 'parent' | 'none';

export interface ActorTechnique {
  id: string;
  name: string;
  tactics: string[];
  /** Rules on the technique (a parent: on it or any of its sub-techniques) */
  rules: number;
  /**
   * covered: rules detect it; parent: only rules on its parent technique
   * (a sub-technique the group uses, detected only generically); none: no rule
   */
  state: TechniqueState;
}

/**
 * How well rules cover the techniques a group or software uses.
 * `rulesByTechnique`: technique ID → rules mapped to exactly that ID.
 */
export function actorCoverage(techniques: string[], rulesByTechnique: Map<string, Set<number>>) {
  const subRules = new Map<string, Set<number>>();
  for (const [id, rules] of rulesByTechnique) {
    if (!id.includes('.')) continue;
    const parent = parentTechniqueId(id);
    if (!subRules.has(parent)) subRules.set(parent, new Set());
    for (const r of rules) subRules.get(parent)!.add(r);
  }
  const list: ActorTechnique[] = techniques.map((id) => {
    const t = TECHNIQUE_BY_ID.get(id);
    const own = rulesByTechnique.get(id)?.size ?? 0;
    let rules = own;
    let state: TechniqueState = own ? 'covered' : 'none';
    if (!id.includes('.')) {
      rules = new Set([...(rulesByTechnique.get(id) ?? []), ...(subRules.get(id) ?? [])]).size;
      if (rules) state = 'covered';
    } else if (!own && rulesByTechnique.get(parentTechniqueId(id))?.size) {
      state = 'parent';
      rules = rulesByTechnique.get(parentTechniqueId(id))!.size;
    }
    return { id, name: t?.name ?? id, tactics: t?.tactics ?? [], rules, state };
  });
  const covered = list.filter((t) => t.state === 'covered').length;
  return {
    techniques: list,
    total: list.length,
    covered,
    parentOnly: list.filter((t) => t.state === 'parent').length,
    pct: list.length ? Math.round((covered / list.length) * 100) : 0,
  };
}
