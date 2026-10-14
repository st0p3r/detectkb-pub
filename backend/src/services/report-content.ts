import { TECHNIQUE_BY_ID, findTactic, parentTechniqueId, parseTechniqueIds, resolveTechniqueId } from '../lib/attack';

// What the exported documents (PDF and HTML) say about rules: labels, ATT&CK
// names for the IDs rules list, a rule's description and its references.

export const SOURCE_LABELS: Record<string, string> = { sigma: 'Sigma', escu: 'Splunk ESCU', elastic: 'Elastic', sentinel: 'Microsoft Sentinel' };
export const LANGUAGE_LABELS: Record<string, string> = { kql: 'KQL', eql: 'EQL', esql: 'ES|QL', kuery: 'KQL (Kibana)', lucene: 'Lucene' };
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
export const STATUSES = ['production', 'testing', 'draft', 'deprecated'];
export const PAGE_TYPE_LABELS: Record<string, string> = { RULE: 'Detection rule', CONCEPT: 'Concept', DATA_SOURCE: 'Data source', NOTE: 'Note', SPL_COMMAND: 'SPL command' };

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const day = (d: Date) => d.toISOString().slice(0, 10);

/** Techniques of a rule with their names; retired IDs shown under their replacement. */
export function techniqueLines(raw: string | null | undefined): string[] {
  return parseTechniqueIds(raw).map((id) => {
    const current = resolveTechniqueId(id) ?? id;
    const t = TECHNIQUE_BY_ID.get(current);
    const parent = current.includes('.') ? TECHNIQUE_BY_ID.get(parentTechniqueId(current)) : undefined;
    const name = t ? (parent ? `${parent.name}: ${t.name}` : t.name) : 'not in ATT&CK';
    return `${current}  ${name}${current !== id ? `  (written as ${id})` : ''}`;
  });
}

/** Tactic names: from the rule's tactic field, else from its techniques. */
export function tacticNames(r: { mitreTactics?: string | null; mitreTechniques?: string | null }): string[] {
  const named = (r.mitreTactics ?? '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => findTactic(s))
    .filter((t): t is NonNullable<typeof t> => !!t);
  const tactics = named.length
    ? named
    : parseTechniqueIds(r.mitreTechniques)
        .flatMap((id) => TECHNIQUE_BY_ID.get(resolveTechniqueId(id) ?? id)?.tactics ?? [])
        .map((s) => findTactic(s))
        .filter((t): t is NonNullable<typeof t> => !!t);
  return Array.from(new Map(tactics.map((t) => [t.id, `${t.name} (${t.id})`])).values());
}

/** The text before the first heading of a page: the rule's description. */
export function description(md: string | null | undefined, max = 1400): string {
  const body = (md ?? '').split(/\n#{1,6}\s/)[0].trim();
  if (body.length <= max) return body;
  const cut = body.slice(0, max);
  const end = cut.lastIndexOf('. ');
  return `${end > max / 2 ? cut.slice(0, end + 1) : cut.trimEnd()} …`;
}

/** Reference lines → link bullets (URLs, Markdown links) or text. */
export function referenceItems(refs: string): { text: string; link?: string }[] {
  return refs
    .split(/\n/)
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const md = l.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (md) return { text: `${md[1]} — ${md[2]}`, link: md[2] };
      const url = l.match(/^https?:\/\/\S+$/);
      return url ? { text: l, link: l } : { text: l };
    });
}

export function coveredTechniques(rules: { mitreTechniques?: string | null }[]) {
  const ids = new Set<string>();
  for (const r of rules) for (const id of parseTechniqueIds(r.mitreTechniques)) ids.add(resolveTechniqueId(id) ?? id);
  return ids;
}

