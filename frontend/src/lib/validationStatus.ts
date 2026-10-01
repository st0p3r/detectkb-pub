import type { RunResult, ValidationStatus } from '@/lib/api';

/** A rule's lab validation status (see the backend's lib/validation). */
export const VALIDATION: Record<ValidationStatus, { label: string; hint: string; className: string }> = {
  validated: {
    label: 'Validated',
    hint: 'Its latest lab test detected the attack, with the current query, within the last 90 days.',
    className: 'text-emerald-700 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  },
  partial: {
    label: 'Partly validated',
    hint: 'Its latest lab test detected part of the attack.',
    className: 'text-sky-700 dark:text-sky-400 border-sky-500/40 bg-sky-500/10',
  },
  failed: {
    label: 'Failed in lab',
    hint: 'Its latest lab test did not detect the attack.',
    className: 'text-red-700 dark:text-red-400 border-red-500/40 bg-red-500/10',
  },
  stale: {
    label: 'Retest',
    hint: 'The query changed after the last lab test, or the test is older than 90 days.',
    className: 'text-amber-700 dark:text-amber-400 border-amber-500/40 bg-amber-500/10',
  },
  never: {
    label: 'Not tested',
    hint: 'No lab test result is recorded for this rule.',
    className: 'text-muted-foreground border-border bg-muted/50',
  },
};

export const RUN_RESULT: Record<RunResult, { label: string; className: string }> = {
  detected: { label: 'Detected', className: 'text-emerald-700 dark:text-emerald-400' },
  'not-detected': { label: 'Not detected', className: 'text-red-700 dark:text-red-400' },
  partial: { label: 'Partly detected', className: 'text-sky-700 dark:text-sky-400' },
  blocked: { label: 'Blocked (did not run)', className: 'text-muted-foreground' },
  error: { label: 'Test error', className: 'text-muted-foreground' },
};

export const RUN_RESULTS = Object.keys(RUN_RESULT) as RunResult[];
