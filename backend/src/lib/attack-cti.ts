import ctiData from '../data/attack-cti.json';
import { TECHNIQUE_BY_ID, parentTechniqueId } from './attack';

// ATT&CK threat groups, software (malware and tools) and mitigations, with the
// techniques they use / mitigate. The bundled copy is regenerated with
// `node scripts/update-attack-data.js` (together with attack-enterprise.json)
// and replaced at startup by a newer one imported in the app.

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

// Updated in place when ATT&CK data is replaced (see setAttackData in ./attack)
export const GROUPS: AttackGroup[] = [];
export const SOFTWARE: AttackSoftware[] = [];
export const MITIGATIONS: AttackMitigation[] = [];

export const GROUP_BY_ID = new Map<string, AttackGroup>();
export const SOFTWARE_BY_ID = new Map<string, AttackSoftware>();
export const MITIGATION_BY_ID = new Map<string, AttackMitigation>();

/** technique ID → groups / software / mitigations that list it */
export const GROUPS_BY_TECHNIQUE = new Map<string, AttackGroup[]>();
export const SOFTWARE_BY_TECHNIQUE = new Map<string, AttackSoftware[]>();
export const MITIGATIONS_BY_TECHNIQUE = new Map<string, AttackMitigation[]>();

function fill<T extends { id: string; techniques: string[] }>(list: T[], items: T[], byId: Map<string, T>, byTechnique: Map<string, T[]>) {
  list.splice(0, list.length, ...items);
  byId.clear();
  byTechnique.clear();
  for (const item of items) {
    byId.set(item.id, item);
    for (const t of item.techniques) {
      if (!byTechnique.has(t)) byTechnique.set(t, []);
      byTechnique.get(t)!.push(item);
    }
  }
}

/** Replaces groups, software and mitigations (startup, in-app ATT&CK update). */
export function setCtiData(data: { groups: AttackGroup[]; software: AttackSoftware[]; mitigations: AttackMitigation[] }) {
  fill(GROUPS, data.groups, GROUP_BY_ID, GROUPS_BY_TECHNIQUE);
  fill(SOFTWARE, data.software, SOFTWARE_BY_ID, SOFTWARE_BY_TECHNIQUE);
  fill(MITIGATIONS, data.mitigations, MITIGATION_BY_ID, MITIGATIONS_BY_TECHNIQUE);
}
setCtiData(ctiData as { groups: AttackGroup[]; software: AttackSoftware[]; mitigations: AttackMitigation[] });

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
// Rules on any sub-technique of each parent, per rulesByTechnique map (lists
// compute the coverage of hundreds of groups / software from the same map)
const subRulesMemo = new WeakMap<ReadonlyMap<string, ReadonlySet<number>>, Map<string, Set<number>>>();
function subRulesOf(rulesByTechnique: ReadonlyMap<string, ReadonlySet<number>>) {
  let subRules = subRulesMemo.get(rulesByTechnique);
  if (!subRules) {
    subRules = new Map();
    for (const [id, rules] of rulesByTechnique) {
      if (!id.includes('.')) continue;
      const parent = parentTechniqueId(id);
      if (!subRules.has(parent)) subRules.set(parent, new Set());
      for (const r of rules) subRules.get(parent)!.add(r);
    }
    subRulesMemo.set(rulesByTechnique, subRules);
  }
  return subRules;
}

export function actorCoverage(techniques: string[], rulesByTechnique: ReadonlyMap<string, ReadonlySet<number>>) {
  const subRules = subRulesOf(rulesByTechnique);
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
