import type { LinkBasis } from '@/lib/api';

/** How much a link can be trusted, and where it comes from. */
export const LINK_BASIS: Record<LinkBasis, { label: string; hint: string; className: string }> = {
  official: {
    label: 'official',
    hint: 'From MITRE ATT&CK data',
    className: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  },
  declared: {
    label: 'declared',
    hint: "Named by the rule itself (its data sources, tables, logsource or ATT&CK field)",
    className: 'border-sky-500/40 text-sky-700 dark:text-sky-300',
  },
  manual: { label: 'manual', hint: 'Set by a user', className: 'border-violet-500/40 text-violet-700 dark:text-violet-300' },
  inferred: {
    label: 'inferred',
    hint: 'Derived by DetectKB (EventID filters in the query, or a Sigma category mapping) — the rule does not name it',
    className: 'border-amber-500/50 border-dashed text-amber-700 dark:text-amber-300',
  },
  'text-match': {
    label: 'text match',
    hint: "Found by name in the rule's text — the rule may not actually detect it",
    className: 'border-orange-500/50 border-dashed text-orange-700 dark:text-orange-300',
  },
};

/** A chip border style for a link of the given basis (dashed = weaker evidence). */
export const basisChip = (basis: LinkBasis | undefined) => (basis === 'inferred' || basis === 'text-match' ? 'border-dashed' : '');
