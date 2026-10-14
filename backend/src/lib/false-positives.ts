import { prisma } from './prisma';
import { parseRuleFile } from './rule-import';

// Rules imported before DetectKB read Elastic's investigation guides have no
// false-positive notes, although their source file has a "False positive
// analysis" section. Filled in from the stored source at startup; a note
// someone wrote (or an empty one cleared later) is never overwritten — only
// rules whose field is empty are touched.

export async function fillFalsePositivesFromSource(): Promise<number> {
  const rules = await prisma.detectionRule.findMany({
    where: { sourceFormat: 'elastic', sourceContent: { not: null }, OR: [{ falsePositives: null }, { falsePositives: '' }] },
    select: { id: true, sourceContent: true },
  });
  let filled = 0;
  for (const r of rules) {
    let fp: string | null | undefined;
    try {
      fp = parseRuleFile('rule.toml', r.sourceContent!)[0]?.rule?.falsePositives;
    } catch {
      continue;
    }
    if (!fp) continue;
    await prisma.detectionRule.update({ where: { id: r.id }, data: { falsePositives: fp } });
    filled++;
  }
  if (filled) {
    await prisma.auditLog.create({
      data: { userId: null, action: 'RULE_FP_FROM_SOURCE', resourceType: 'rule', newValue: { rules: filled, from: 'Elastic investigation guides' } },
    });
    console.log(`[rules] false positives filled from the source of ${filled} Elastic rules`);
  }
  return filled;
}
