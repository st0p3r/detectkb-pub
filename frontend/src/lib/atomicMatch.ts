import type { AtomicRuleMatch } from '@/lib/api';

/** How a rule relates to an atomic test of its technique (see the backend's matchRule). */
export const ATOMIC_MATCH: Record<AtomicRuleMatch, { label: string; hint: string; className: string }> = {
  telemetry: {
    label: 'Sees its telemetry',
    hint: 'The rule reads telemetry this test is expected to produce, so it may fire. Only running the test proves it.',
    className: 'text-emerald-700 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  },
  edr: {
    label: 'Needs the EDR',
    hint: 'The rule reads an EDR/XDR product; it can only fire where that product is deployed.',
    className: 'text-sky-700 dark:text-sky-400 border-sky-500/40 bg-sky-500/10',
  },
  'other-telemetry': {
    label: 'Other telemetry',
    hint: 'Same technique, but the rule reads telemetry this test is not expected to produce.',
    className: 'text-amber-700 dark:text-amber-400 border-amber-500/40 bg-amber-500/10',
  },
  unknown: {
    label: 'No telemetry links',
    hint: 'Same technique; the rule has no telemetry links, so DetectKB cannot tell.',
    className: 'text-muted-foreground border-border bg-muted/50',
  },
};

export const ATOMIC_MATCH_ORDER: AtomicRuleMatch[] = ['telemetry', 'edr', 'other-telemetry', 'unknown'];

export const PLATFORM_LABEL: Record<string, string> = {
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS',
  containers: 'Containers',
  'office-365': 'Office 365',
  'azure-ad': 'Entra ID',
  'google-workspace': 'Google Workspace',
  'iaas:aws': 'AWS',
  'iaas:azure': 'Azure',
  'iaas:gcp': 'GCP',
};

export const EXECUTOR_LABEL: Record<string, string> = {
  powershell: 'PowerShell',
  command_prompt: 'cmd',
  sh: 'sh',
  bash: 'bash',
  manual: 'Manual',
};
