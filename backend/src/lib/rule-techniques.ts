import { prisma } from './prisma';
import { parentTechniqueId, parseTechniqueIds, resolveTechniqueId } from './attack';

// A rule's ATT&CK techniques as rows (RuleTechnique), derived from its
// comma-separated mitreTechniques field, so rules can be found by technique
// with an index instead of reading and parsing every rule. Retired IDs are
// stored resolved to MITRE's replacement, next to the ID as written.

export interface TechniqueRow {
  pageId: number;
  rawId: string;
  techniqueId: string | null;
  parentId: string | null;
}

/** The rows for one rule's technique field. */
export function techniqueRows(pageId: number, mitreTechniques: string | null): TechniqueRow[] {
  return parseTechniqueIds(mitreTechniques).map((rawId) => {
    const techniqueId = resolveTechniqueId(rawId);
    return { pageId, rawId, techniqueId, parentId: techniqueId ? parentTechniqueId(techniqueId) : null };
  });
}

const rowKey = (r: TechniqueRow) => `${r.pageId}|${r.rawId}|${r.techniqueId ?? ''}`;

async function sync(rules: { pageId: number; mitreTechniques: string | null }[], all: boolean) {
  const want = new Map(rules.flatMap((r) => techniqueRows(r.pageId, r.mitreTechniques)).map((r) => [rowKey(r), r]));
  const existing = await prisma.ruleTechnique.findMany({ where: all ? {} : { pageId: { in: rules.map((r) => r.pageId) } } });
  const have = new Set(existing.map(rowKey));
  // A row whose resolution changed (ATT&CK update) is replaced
  const stale = existing.filter((r) => !want.has(rowKey(r)));
  const added = Array.from(want.values()).filter((r) => !have.has(rowKey(r)));
  for (let i = 0; i < stale.length; i += 500) {
    await prisma.ruleTechnique.deleteMany({ where: { OR: stale.slice(i, i + 500).map(({ pageId, rawId }) => ({ pageId, rawId })) } });
  }
  for (let i = 0; i < added.length; i += 1000) await prisma.ruleTechnique.createMany({ data: added.slice(i, i + 1000), skipDuplicates: true });
  return { added: added.length, removed: stale.length };
}

/** Recomputes a page's technique rows (after it is saved or imported). */
export async function syncRuleTechniques(pageId: number) {
  const rule = await prisma.detectionRule.findUnique({ where: { pageId }, select: { pageId: true, mitreTechniques: true } });
  if (rule) return sync([rule], false);
  await prisma.ruleTechnique.deleteMany({ where: { pageId } });
  return { added: 0, removed: 0 };
}

/** Recomputes every rule's technique rows (startup, restore; ATT&CK data may have changed). */
export async function syncAllRuleTechniques() {
  const rules = await prisma.detectionRule.findMany({ select: { pageId: true, mitreTechniques: true } });
  return sync(rules, true);
}

/**
 * Where clause (on Page) for rules mapped to a technique: the technique itself,
 * its sub-techniques when it is a parent, and rules still using a retired ID
 * MITRE replaced with it.
 */
export function techniquePageWhere(id: string) {
  const t = id.trim().toUpperCase();
  return { techniques: { some: { OR: [{ techniqueId: t }, { parentId: t }, { rawId: t }] } } };
}
