// How much a technique's coverage can be trusted, from its best rule:
// a deployed rule proven in the lab beats one in production, which beats one
// still being tested, which beats a draft nobody runs yet.

export const CONFIDENCE_LEVELS = ['validated', 'production', 'testing', 'draft'] as const;
export type CoverageConfidence = (typeof CONFIDENCE_LEVELS)[number];

const RANK: Record<CoverageConfidence, number> = { validated: 3, production: 2, testing: 1, draft: 0 };

/** A rule's level; null for rules that don't count (deprecated). */
export function ruleConfidence(rule: { status: string; validation?: string }): CoverageConfidence | null {
  if (rule.status === 'deprecated') return null;
  // A draft proven in the lab still isn't running anywhere
  if (rule.status === 'production' || rule.status === 'testing') return rule.validation === 'validated' ? 'validated' : rule.status;
  return 'draft';
}

/** The best level among some rules (null when none counts). */
export function bestConfidence(rules: Iterable<{ status: string; validation?: string }>): CoverageConfidence | null {
  let best: CoverageConfidence | null = null;
  for (const r of rules) {
    const c = ruleConfidence(r);
    if (c && (!best || RANK[c] > RANK[best])) best = c;
  }
  return best;
}
