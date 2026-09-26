import { prisma } from './prisma';
import { TACTICS, TECHNIQUE_BY_ID, parentTechniqueId, parseTechniqueIds, resolveTechniqueId } from './attack';
import { kbCache } from './kb-cache';

// Coverage seen through telemetry: which rules and techniques depend on which
// Sysmon events (impact analysis), and how detections flow from events to
// ATT&CK tactics (Sankey view).

export interface RuleTelemetry {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  sourceFormat: string | null;
  /** The rule's free-text data source field */
  dataSource: string | null;
  /** Current ATT&CK technique IDs */
  techniques: string[];
  /** Sysmon event IDs the rule depends on (auto-detected or set by hand) */
  sysmon: number[];
}

const telemetryCache = kbCache(async (): Promise<RuleTelemetry[]> => {
  const rules = await prisma.detectionRule.findMany({
    select: {
      status: true,
      severity: true,
      sourceFormat: true,
      dataSource: true,
      mitreTechniques: true,
      page: { select: { id: true, title: true, slug: true, sysmonEvents: { select: { sysmonEvent: { select: { eventId: true } } } } } },
    },
  });
  return rules.map((r) => ({
    pageId: r.page.id,
    title: r.page.title,
    slug: r.page.slug,
    status: r.status,
    severity: r.severity,
    sourceFormat: r.sourceFormat,
    dataSource: r.dataSource,
    techniques: Array.from(new Set(parseTechniqueIds(r.mitreTechniques).map(resolveTechniqueId).filter((t): t is string => !!t))),
    sysmon: r.page.sysmonEvents.map((s) => s.sysmonEvent.eventId).sort((a, b) => a - b),
  }));
});

/** Every rule's techniques and Sysmon events (cached until data changes). */
export function loadRuleTelemetry() {
  return telemetryCache.get();
}

/**
 * Sources other than Sysmon that a rule's data source field lists, e.g.
 * "Sysmon EventID 1, Windows Event Log Security 4688" → ["Windows Event Log
 * Security 4688"]. A Sigma logsource ("product:windows category:…") is what
 * the Sysmon links were derived from, so it doesn't count as another source.
 */
export function otherDataSources(dataSource: string | null): string[] {
  if (!dataSource) return [];
  return dataSource
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s && !/sysmon/i.test(s) && !/^(product|category|service):/i.test(s));
}

export type ImpactLevel = 'lost' | 'atRisk' | 'partial';

export interface ImpactedRule extends Pick<RuleTelemetry, 'pageId' | 'title' | 'slug' | 'status' | 'severity' | 'techniques' | 'sysmon'> {
  level: ImpactLevel;
  /** Sysmon events of the rule that are gone */
  lostEvents: number[];
  /** Other data sources the rule lists, which may still feed it */
  alternatives: string[];
}

export interface TechniqueImpact {
  id: string;
  name: string;
  /** Active rules before */
  rules: number;
  lost: number;
  atRisk: number;
}

/**
 * What stops working if the given Sysmon events are no longer collected.
 * Per rule (deprecated rules ignored):
 *  - lost: every Sysmon event it uses is gone and it lists no other source
 *  - atRisk: every Sysmon event it uses is gone, but it lists other sources
 *  - partial: some of its Sysmon events are gone
 * Per technique: uncovered when all its rules are lost, reduced otherwise.
 */
export function analyzeImpact(rules: RuleTelemetry[], lostEvents: Set<number>) {
  const active = rules.filter((r) => r.status !== 'deprecated');
  const impacted: ImpactedRule[] = [];
  for (const r of active) {
    const lost = r.sysmon.filter((e) => lostEvents.has(e));
    if (!lost.length) continue;
    const alternatives = otherDataSources(r.dataSource);
    const level: ImpactLevel = lost.length < r.sysmon.length ? 'partial' : alternatives.length ? 'atRisk' : 'lost';
    const { pageId, title, slug, status, severity, techniques, sysmon } = r;
    impacted.push({ pageId, title, slug, status, severity, techniques, sysmon, level, lostEvents: lost, alternatives });
  }

  const byTechnique = new Map<string, TechniqueImpact>();
  for (const r of active) {
    for (const id of r.techniques) {
      if (!byTechnique.has(id)) byTechnique.set(id, { id, name: TECHNIQUE_BY_ID.get(id)?.name ?? id, rules: 0, lost: 0, atRisk: 0 });
      byTechnique.get(id)!.rules++;
    }
  }
  for (const r of impacted) {
    for (const id of r.techniques) {
      const t = byTechnique.get(id)!;
      if (r.level === 'lost') t.lost++;
      else if (r.level === 'atRisk') t.atRisk++;
    }
  }
  const affected = Array.from(byTechnique.values()).filter((t) => t.lost || t.atRisk);
  const order = { lost: 0, atRisk: 1, partial: 2 };
  return {
    rules: impacted.sort((a, b) => order[a.level] - order[b.level] || a.title.localeCompare(b.title)),
    counts: {
      activeRules: active.length,
      lost: impacted.filter((r) => r.level === 'lost').length,
      atRisk: impacted.filter((r) => r.level === 'atRisk').length,
      partial: impacted.filter((r) => r.level === 'partial').length,
    },
    /** Techniques whose every rule is lost */
    uncovered: affected.filter((t) => t.lost === t.rules).sort((a, b) => b.rules - a.rules || a.id.localeCompare(b.id)),
    /** Techniques that keep some rules but lose or risk others */
    reduced: affected.filter((t) => t.lost < t.rules).sort((a, b) => b.lost + b.atRisk - (a.lost + a.atRisk) || a.id.localeCompare(b.id)),
  };
}

export const NO_SYSMON = 'none';

export interface Flows {
  /** Left column: Sysmon events ("sysmon:10") and rules without one ("sysmon:none") */
  sources: { id: string; eventId: number | null; rules: number }[];
  /** Right column: tactics, or a tactic's techniques when drilling down */
  targets: { id: string; label: string; rules: number }[];
  links: { source: string; target: string; rules: number }[];
  /** Rules shown (with a technique, and a Sysmon link unless withoutSysmon) */
  rules: number;
}

/**
 * How detections flow from telemetry to ATT&CK: rules counted per (Sysmon
 * event, tactic) pair. A rule with events {1, 10} mapped to credential access
 * adds one to 1→credential-access and one to 10→credential-access. With
 * `tactic`, the right column is that tactic's (parent) techniques instead.
 * withoutSysmon: false leaves out rules with no Sysmon link (default: they
 * form one "sysmon:none" source).
 */
export function computeFlows(rules: RuleTelemetry[], opts: { tactic?: string; withoutSysmon?: boolean } = {}): Flows {
  const links = new Map<string, Set<number>>();
  const sourceRules = new Map<string, Set<number>>();
  const targetRules = new Map<string, Set<number>>();
  const shown = new Set<number>();
  const add = (map: Map<string, Set<number>>, key: string, rule: number) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(rule);
  };

  for (const r of rules) {
    const targets = new Set<string>();
    for (const id of r.techniques) {
      const t = TECHNIQUE_BY_ID.get(id) ?? TECHNIQUE_BY_ID.get(parentTechniqueId(id));
      if (!t) continue;
      if (opts.tactic) {
        if (t.tactics.includes(opts.tactic)) targets.add(`technique:${parentTechniqueId(id)}`);
      } else {
        for (const tactic of t.tactics) targets.add(`tactic:${tactic}`);
      }
    }
    if (!targets.size || (!r.sysmon.length && opts.withoutSysmon === false)) continue;
    shown.add(r.pageId);
    const sources = r.sysmon.length ? r.sysmon.map((e) => `sysmon:${e}`) : [`sysmon:${NO_SYSMON}`];
    for (const s of sources) {
      add(sourceRules, s, r.pageId);
      for (const t of targets) {
        add(links, `${s}|${t}`, r.pageId);
        add(targetRules, t, r.pageId);
      }
    }
  }

  const tacticOrder = new Map(TACTICS.map((t, i) => [t.shortname, i]));
  const targetLabel = (id: string) => {
    const [kind, key] = id.split(':');
    if (kind === 'tactic') return TACTICS.find((t) => t.shortname === key)?.name ?? key;
    return `${key} ${TECHNIQUE_BY_ID.get(key)?.name ?? ''}`.trim();
  };
  return {
    sources: Array.from(sourceRules, ([id, set]) => {
      const key = id.split(':')[1];
      return { id, eventId: key === NO_SYSMON ? null : Number(key), rules: set.size };
    }).sort((a, b) => (a.eventId ?? Infinity) - (b.eventId ?? Infinity)),
    targets: Array.from(targetRules, ([id, set]) => ({ id, label: targetLabel(id), rules: set.size })).sort((a, b) =>
      opts.tactic ? b.rules - a.rules : (tacticOrder.get(a.id.split(':')[1]) ?? 99) - (tacticOrder.get(b.id.split(':')[1]) ?? 99)
    ),
    links: Array.from(links, ([key, set]) => {
      const [source, target] = key.split('|');
      return { source, target, rules: set.size };
    }),
    rules: shown.size,
  };
}
