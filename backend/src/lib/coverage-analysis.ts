import { prisma } from './prisma';
import { TACTICS, TECHNIQUE_BY_ID, parentTechniqueId, parseTechniqueIds, resolveTechniqueId } from './attack';
import { kbCache } from './kb-cache';
import { LOG_SOURCES, parseDataSourceName, parseProductName } from './log-events';

// Coverage seen through telemetry: which rules and techniques depend on which
// events (impact analysis), and how detections flow from telemetry to ATT&CK
// tactics (Sankey view).
//
// Telemetry keys: "sysmon:10" for Sysmon for Windows, and log event keys
// ("windows-security:4688", "crowdstrike:processrollup2", "elastic-defend:*")
// for everything else. A key's source is the part before the colon.

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
  /** Every telemetry key the rule depends on: sysmon:N and log event keys */
  telemetry: string[];
  /** Keys needed all at once ("Sysmon EventID 1 AND Sysmon EventID 11"), see alternatives() */
  groups: string[][];
}

/**
 * The ways a rule can be fed: each AND group is one alternative (all its keys
 * are needed), every other key is an alternative of its own.
 */
export function alternatives(r: Pick<RuleTelemetry, 'telemetry' | 'groups'>): string[][] {
  const known = new Set(r.telemetry);
  const groups = r.groups.map((g) => g.filter((k) => known.has(k))).filter((g) => g.length);
  const grouped = new Set(groups.flat());
  return [...groups, ...r.telemetry.filter((k) => !grouped.has(k)).map((k) => [k])];
}

export interface TelemetryInfo {
  key: string;
  /** "sysmon" or a log source key */
  source: string;
  sourceLabel: string;
  label: string;
}

export const telemetrySource = (key: string) => key.slice(0, key.indexOf(':'));

interface TelemetryData {
  rules: RuleTelemetry[];
  /** key → labels, for every key some page uses */
  info: Map<string, TelemetryInfo>;
}

const telemetryCache = kbCache(async (): Promise<TelemetryData> => {
  const [rules, sysmonEvents, logEvents] = await Promise.all([
    prisma.detectionRule.findMany({
      select: {
        status: true,
        severity: true,
        sourceFormat: true,
        dataSource: true,
        mitreTechniques: true,
        page: {
          select: {
            id: true,
            title: true,
            slug: true,
            sysmonEvents: { select: { sysmonEvent: { select: { eventId: true } } } },
            logEvents: { select: { logEvent: { select: { key: true } } } },
            telemetryAll: { select: { keys: true } },
          },
        },
      },
    }),
    prisma.sysmonEvent.findMany({ select: { eventId: true, name: true } }),
    prisma.logEvent.findMany({ select: { key: true, source: true, sourceLabel: true, code: true, name: true } }),
  ]);
  const info = new Map<string, TelemetryInfo>();
  for (const e of sysmonEvents) {
    info.set(`sysmon:${e.eventId}`, { key: `sysmon:${e.eventId}`, source: 'sysmon', sourceLabel: 'Sysmon', label: `Sysmon ${e.eventId} · ${e.name}` });
  }
  for (const e of logEvents) {
    const label = e.code === '*' ? `${e.sourceLabel} (any event)` : /^\d+$/.test(e.code) ? `${e.sourceLabel} ${e.code} · ${e.name}` : `${e.sourceLabel} · ${e.name}`;
    info.set(e.key, { key: e.key, source: e.source, sourceLabel: e.sourceLabel, label });
  }
  return {
    info,
    rules: rules.map((r) => {
      const sysmon = r.page.sysmonEvents.map((s) => s.sysmonEvent.eventId).sort((a, b) => a - b);
      return {
        pageId: r.page.id,
        title: r.page.title,
        slug: r.page.slug,
        status: r.status,
        severity: r.severity,
        sourceFormat: r.sourceFormat,
        dataSource: r.dataSource,
        techniques: Array.from(new Set(parseTechniqueIds(r.mitreTechniques).map(resolveTechniqueId).filter((t): t is string => !!t))),
        sysmon,
        telemetry: [...sysmon.map((e) => `sysmon:${e}`), ...r.page.logEvents.map((l) => l.logEvent.key).sort()],
        groups: r.page.telemetryAll.map((g) => (Array.isArray(g.keys) ? g.keys.map(String) : [])),
      };
    }),
  };
});

/** Every rule's techniques and telemetry (cached until data changes). */
export async function loadRuleTelemetry(): Promise<RuleTelemetry[]> {
  return (await telemetryCache.get()).rules;
}

/** Labels of every telemetry key in use (cached until data changes). */
export async function loadTelemetryInfo(): Promise<Map<string, TelemetryInfo>> {
  return (await telemetryCache.get()).info;
}

/**
 * Names in a rule's data source field that DetectKB couldn't turn into a
 * telemetry link (neither Sysmon nor a known log event), e.g. "Winlogbeat".
 * They may still feed the rule. A Sigma logsource ("product:windows
 * category:…") is what the links were derived from, so it doesn't count.
 */
export function otherDataSources(dataSource: string | null, sourceFormat: string | null = null): string[] {
  // ESCU names are all linked (unknown ones under "Other"), and so are Sentinel tables
  if (!dataSource || sourceFormat === 'escu' || sourceFormat === 'sentinel') return [];
  return dataSource
    .split(/\s*[,;\n]\s*|\s+AND\s+/)
    .map((s) => s.trim().replace(/…$/, ''))
    .filter((s) => s && !/^(product|category|service):/i.test(s))
    .filter((s) => !parseDataSourceName(s) && !parseProductName(s));
}

export type ImpactLevel = 'lost' | 'atRisk' | 'partial';

export interface ImpactedRule extends Pick<RuleTelemetry, 'pageId' | 'title' | 'slug' | 'status' | 'severity' | 'techniques' | 'telemetry' | 'groups'> {
  level: ImpactLevel;
  /** Telemetry keys of the rule that are gone */
  lostEvents: string[];
  /** Data sources the rule names that DetectKB couldn't map, which may still feed it */
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
 * The telemetry keys lost when these sources and events stop: every key of a
 * lost source (sysmon, windows-security, …) plus the listed keys.
 */
export function expandLost(all: Iterable<string>, sources: string[], events: string[]): Set<string> {
  const lost = new Set(events);
  const bySource = new Set(sources);
  for (const key of all) if (bySource.has(telemetrySource(key))) lost.add(key);
  return lost;
}

/**
 * What stops working if the given telemetry is no longer collected. A rule is
 * fed while any of its alternatives (see alternatives()) is complete. Per rule
 * (deprecated rules ignored):
 *  - lost: every alternative lost a key and it names no other data source
 *  - atRisk: every alternative lost a key, but it names data sources DetectKB couldn't map
 *  - partial: some alternatives lost a key, others still feed it
 * Per technique: uncovered when all its rules are lost, reduced otherwise.
 */
export function analyzeImpact(rules: RuleTelemetry[], lostKeys: Set<string>) {
  const active = rules.filter((r) => r.status !== 'deprecated');
  const impacted: ImpactedRule[] = [];
  for (const r of active) {
    const lost = r.telemetry.filter((k) => lostKeys.has(k));
    if (!lost.length) continue;
    const alts = alternatives(r);
    const remaining = alts.filter((a) => !a.some((k) => lostKeys.has(k))).length;
    const unmapped = otherDataSources(r.dataSource, r.sourceFormat);
    const level: ImpactLevel = remaining > 0 ? 'partial' : unmapped.length ? 'atRisk' : 'lost';
    const { pageId, title, slug, status, severity, techniques, telemetry, groups } = r;
    impacted.push({ pageId, title, slug, status, severity, techniques, telemetry, groups, level, lostEvents: lost, alternatives: unmapped });
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

/** Left-column node for rules with no telemetry link */
export const NO_TELEMETRY = 'none';

export type FlowSourceKind = 'source' | 'event' | 'other' | 'none';

export interface Flows {
  /**
   * Left column: log sources ("src:windows-security"), or single events
   * ("ev:sysmon:10") with a source's small events merged ("other:windows-security"),
   * and rules without telemetry ("none")
   */
  sources: { id: string; kind: FlowSourceKind; key: string | null; rules: number }[];
  /** Right column: tactics, or a tactic's techniques when drilling down */
  targets: { id: string; label: string; rules: number }[];
  links: { source: string; target: string; rules: number }[];
  /** Rules shown (with a technique, and a telemetry link unless withoutTelemetry) */
  rules: number;
}

export interface FlowOptions {
  tactic?: string;
  /** false leaves out rules with no telemetry link (default: they form one "none" source) */
  withoutTelemetry?: boolean;
  /** "source" (default): one node per log source; "event": one per event */
  groupBy?: 'source' | 'event';
  /** In event mode, events with fewer rules are merged into their source's "other" node */
  minRules?: number;
}

/**
 * How detections flow from telemetry to ATT&CK: rules counted per (telemetry,
 * tactic) pair. A rule reading Sysmon 1 and Windows Security 4688, mapped to
 * execution, adds one to each source → execution. With `tactic`, the right
 * column is that tactic's (parent) techniques instead.
 */
export function computeFlows(rules: RuleTelemetry[], opts: FlowOptions = {}): Flows {
  const groupBy = opts.groupBy ?? 'source';
  const minRules = opts.minRules ?? 3;
  // In event mode, small events are merged per source
  const eventRules = new Map<string, number>();
  if (groupBy === 'event') for (const r of rules) for (const k of r.telemetry) eventRules.set(k, (eventRules.get(k) ?? 0) + 1);
  const nodeOf = (key: string) => {
    if (groupBy === 'source') return `src:${telemetrySource(key)}`;
    return (eventRules.get(key) ?? 0) >= minRules ? `ev:${key}` : `other:${telemetrySource(key)}`;
  };

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
    if (!targets.size || (!r.telemetry.length && opts.withoutTelemetry === false)) continue;
    shown.add(r.pageId);
    const sources = r.telemetry.length ? Array.from(new Set(r.telemetry.map(nodeOf))) : [NO_TELEMETRY];
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
  const kindOf = (id: string): FlowSourceKind => (id === NO_TELEMETRY ? 'none' : id.startsWith('src:') ? 'source' : id.startsWith('ev:') ? 'event' : 'other');
  const rank = (id: string) => ({ source: 0, event: 0, other: 1, none: 2 })[kindOf(id)];
  return {
    // Biggest first; "other" nodes after the events, "none" last
    sources: Array.from(sourceRules, ([id, set]) => ({
      id,
      kind: kindOf(id),
      key: id === NO_TELEMETRY ? null : id.slice(id.indexOf(':') + 1),
      rules: set.size,
    })).sort((a, b) => rank(a.id) - rank(b.id) || b.rules - a.rules || a.id.localeCompare(b.id)),
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

/** Label of a log source key, for flows and impact ("windows-security" → "Windows Security"). */
export function sourceLabel(source: string, info: Map<string, TelemetryInfo>): string {
  if (source === 'sysmon') return 'Sysmon';
  if (LOG_SOURCES[source]) return LOG_SOURCES[source].label;
  for (const i of info.values()) if (i.source === source) return i.sourceLabel;
  return source;
}
