import { prisma } from './prisma';
import { ruleFieldRefs } from './query-fields';

// Keeps RuleField in step with the rules: the fields each rule's detection
// reads, recomputed when a rule is saved or imported, and for every rule at
// startup.

const RULE_SELECT = { pageId: true, sigmaYaml: true, splQuery: true, nativeQuery: true } as const;

async function sync(rules: { pageId: number; sigmaYaml: string | null; splQuery: string; nativeQuery: string | null }[], pageIds: number[] | null) {
  const want = new Map<string, { pageId: number; field: string; source: string }>();
  for (const r of rules) for (const ref of ruleFieldRefs(r)) want.set(`${r.pageId}|${ref.field.toLowerCase()}`, { pageId: r.pageId, ...ref });
  const existing = await prisma.ruleField.findMany({ where: pageIds ? { pageId: { in: pageIds } } : {} });
  const have = new Map(existing.map((e) => [`${e.pageId}|${e.field.toLowerCase()}`, e]));
  const stale = existing.filter((e) => want.get(`${e.pageId}|${e.field.toLowerCase()}`)?.source !== e.source);
  const added = Array.from(want.entries())
    .filter(([key, w]) => have.get(key)?.source !== w.source)
    .map(([, w]) => w);
  for (let i = 0; i < stale.length; i += 500) {
    await prisma.ruleField.deleteMany({ where: { OR: stale.slice(i, i + 500).map(({ pageId, field }) => ({ pageId, field })) } });
  }
  for (let i = 0; i < added.length; i += 1000) await prisma.ruleField.createMany({ data: added.slice(i, i + 1000), skipDuplicates: true });
  return { added: added.length, removed: stale.length };
}

/** Recomputes one page's fields (none when it is not a rule). */
export async function syncRuleFields(pageId: number) {
  const rule = await prisma.detectionRule.findUnique({ where: { pageId }, select: RULE_SELECT });
  return sync(rule ? [rule] : [], [pageId]);
}

/** Every rule (at startup and after a restore). */
export async function syncAllRuleFields() {
  return sync(await prisma.detectionRule.findMany({ select: RULE_SELECT }), null);
}
