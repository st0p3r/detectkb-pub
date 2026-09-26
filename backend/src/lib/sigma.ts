import { randomUUID } from 'crypto';
import YAML from 'yaml';
import { SIGMA_SERVICE_URL } from './config';
import { TACTICS, findTactic, parseTechniqueIds } from './attack';

export type SigmaDoc = Record<string, unknown>;

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parses every YAML document in `text`; each entry has either `doc` or `error`,
 * plus `source` (that document's own text, comments included).
 */
export function parseSigmaDocuments(text: string): { doc?: SigmaDoc; error?: string; source: string }[] {
  return YAML.parseAllDocuments(text)
    .filter((d) => d.contents !== null)
    .map((d) => {
      if (d.errors.length) return { error: d.errors[0].message, source: '' };
      const doc = d.toJS() as unknown;
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: 'Not a YAML mapping', source: '' };
      return { doc: doc as SigmaDoc, source: d.toString() };
    });
}

/** Returns an error message when `doc` is not a (single, self-contained) Sigma rule. */
export function validateSigmaRule(doc: SigmaDoc): string | null {
  if (doc.action) return `Sigma collections with "action: ${doc.action}" are not supported`;
  if (typeof doc.title !== 'string' || !doc.title.trim()) return 'Missing "title"';
  if (!doc.logsource || typeof doc.logsource !== 'object') return 'Missing "logsource"';
  if (!doc.detection || typeof doc.detection !== 'object') return 'Missing "detection"';
  if (!(doc.detection as SigmaDoc).condition) return 'Missing "detection.condition"';
  return null;
}

/** Parses a single-rule Sigma YAML string, throwing a readable error when invalid. */
export function parseSingleSigmaRule(text: string): SigmaDoc {
  const docs = parseSigmaDocuments(text);
  if (docs.length !== 1) throw new Error(`Expected exactly one Sigma rule, found ${docs.length} YAML documents`);
  if (docs[0].error) throw new Error(`Invalid YAML: ${docs[0].error}`);
  const problem = validateSigmaRule(docs[0].doc!);
  if (problem) throw new Error(`Invalid Sigma rule: ${problem}`);
  return docs[0].doc!;
}

// ── Sigma ↔ DetectKB field mapping ────────────────────────────────────────────

const SIGMA_TO_STATUS: Record<string, string> = {
  experimental: 'draft',
  test: 'testing',
  testing: 'testing',
  stable: 'production',
  deprecated: 'deprecated',
  unsupported: 'deprecated',
};
const STATUS_TO_SIGMA: Record<string, string> = {
  draft: 'experimental',
  testing: 'test',
  production: 'stable',
  deprecated: 'deprecated',
};
const SIGMA_TO_SEVERITY: Record<string, string> = { informational: 'info' };
const SEVERITY_TO_SIGMA: Record<string, string> = { info: 'informational' };

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)];

export interface RuleFieldsFromSigma {
  title: string;
  sigmaId: string | null;
  contentMd: string;
  status: string;
  severity: string;
  mitreTactics: string | null;
  mitreTechniques: string | null;
  dataSource: string | null;
  falsePositives: string | null;
  references: string | null;
}

export function sigmaToRuleFields(doc: SigmaDoc): RuleFieldsFromSigma {
  const tags = asList(doc.tags).map((t) => t.toLowerCase());
  const attackTags = tags.filter((t) => t.startsWith('attack.')).map((t) => t.slice('attack.'.length));
  const techniques = attackTags.filter((t) => /^t\d{4}/.test(t)).map((t) => t.toUpperCase());
  const tactics = Array.from(
    new Set(attackTags.map((t) => findTactic(t)?.id).filter((id): id is string => !!id))
  );

  const logsource = (doc.logsource ?? {}) as Record<string, unknown>;
  const dataSource = ['product', 'service', 'category']
    .filter((k) => logsource[k])
    .map((k) => `${k}:${logsource[k]}`)
    .join(' ');

  const lines: string[] = [];
  if (doc.description) lines.push(String(doc.description).trim(), '');
  const meta = [
    doc.author && `**Author:** ${doc.author}`,
    doc.date && `**Date:** ${doc.date}`,
    doc.modified && `**Modified:** ${doc.modified}`,
    doc.id && `**Sigma ID:** \`${doc.id}\``,
  ].filter(Boolean);
  if (meta.length) lines.push(meta.join('  \n'), '');
  lines.push('_Imported from Sigma. The original rule is stored with this detection and used for conversion._');

  return {
    title: String(doc.title).trim(),
    sigmaId: doc.id ? String(doc.id) : null,
    contentMd: lines.join('\n'),
    status: SIGMA_TO_STATUS[String(doc.status ?? '').toLowerCase()] ?? 'draft',
    severity: SIGMA_TO_SEVERITY[String(doc.level ?? '')] ?? (String(doc.level ?? '') || 'medium'),
    mitreTactics: tactics.length ? tactics.join(', ') : null,
    mitreTechniques: techniques.length ? techniques.join(', ') : null,
    dataSource: dataSource || null,
    falsePositives: asList(doc.falsepositives).join('\n') || null,
    references: asList(doc.references).join('\n') || null,
  };
}

export interface RuleForExport {
  title: string;
  contentMd: string;
  status: string;
  severity: string;
  splQuery: string;
  mitreTactics: string | null;
  mitreTechniques: string | null;
  falsePositives: string | null;
  references: string | null;
  sigmaId: string | null;
  sigmaYaml: string | null;
  sysmonEventIds: number[];
}

function attackTagsFor(rule: RuleForExport): string[] {
  const tactics = (rule.mitreTactics ?? '')
    .split(/[,\n]/)
    .map((t) => findTactic(t))
    .filter((t): t is (typeof TACTICS)[number] => !!t)
    .map((t) => `attack.${t.shortname}`);
  const techniques = parseTechniqueIds(rule.mitreTechniques).map((id) => `attack.${id.toLowerCase()}`);
  return Array.from(new Set([...tactics, ...techniques]));
}

const splitLines = (v: string | null) =>
  (v ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function plainDescription(md: string): string {
  const text = md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[#*_`>]/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('Author:') && !p.startsWith('Imported from Sigma'));
  return (text ?? '').slice(0, 500);
}

/**
 * Builds Sigma YAML for a rule. When the rule was imported from (or written in)
 * Sigma, the stored rule is kept and only its metadata is refreshed from
 * DetectKB; otherwise a skeleton is generated whose detection must be completed.
 * Returns the YAML and the Sigma id used (callers persist new ids).
 */
export function ruleToSigma(rule: RuleForExport): { yaml: string; sigmaId: string; isSkeleton: boolean } {
  const sigmaId = rule.sigmaId ?? randomUUID();
  const metadata: SigmaDoc = {
    title: rule.title,
    id: sigmaId,
    status: STATUS_TO_SIGMA[rule.status] ?? 'experimental',
  };
  const falsepositives = splitLines(rule.falsePositives);
  const references = splitLines(rule.references);
  const attackTags = attackTagsFor(rule);
  const level = SEVERITY_TO_SIGMA[rule.severity] ?? rule.severity;

  if (rule.sigmaYaml) {
    const doc = YAML.parseDocument(rule.sigmaYaml);
    doc.set('title', metadata.title);
    doc.set('id', sigmaId);
    doc.set('status', metadata.status);
    doc.set('level', level);
    const otherTags = asList((doc.toJS() as SigmaDoc).tags).filter((t) => !t.toLowerCase().startsWith('attack.'));
    const tags = [...attackTags, ...otherTags];
    if (tags.length) doc.set('tags', tags);
    else doc.delete('tags');
    if (references.length) doc.set('references', references);
    if (falsepositives.length) doc.set('falsepositives', falsepositives);
    return { yaml: doc.toString(), sigmaId, isSkeleton: false };
  }

  const usesSysmon = rule.sysmonEventIds.length > 0;
  const skeleton: SigmaDoc = {
    ...metadata,
    description: plainDescription(rule.contentMd) || rule.title,
    references: references.length ? references : undefined,
    tags: attackTags.length ? attackTags : undefined,
    logsource: usesSysmon ? { product: 'windows', service: 'sysmon' } : { product: 'TODO' },
    detection: {
      selection: usesSysmon ? { EventID: rule.sysmonEventIds } : { TODO: 'replace with detection logic' },
      condition: 'selection',
    },
    falsepositives: falsepositives.length ? falsepositives : undefined,
    level,
  };
  const doc = new YAML.Document(JSON.parse(JSON.stringify(skeleton)));
  const spl = rule.splQuery.trim()
    ? '\nOriginal SPL:\n' + rule.splQuery.trim().split('\n').map((l) => `  ${l}`).join('\n')
    : '';
  doc.commentBefore = ` Skeleton generated by DetectKB — complete logsource and detection before use.${spl}`
    .split('\n')
    .map((line) => (line.startsWith(' ') ? line : ` ${line}`))
    .join('\n');
  return { yaml: doc.toString(), sigmaId, isSkeleton: true };
}

// ── Conversion service client ────────────────────────────────────────────────

export interface SigmaTarget {
  id: string;
  label: string;
  language: string;
}

export class SigmaServiceError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function callService<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SIGMA_SERVICE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new SigmaServiceError('Sigma conversion service is not reachable', 503);
  }
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (!res.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : `Conversion failed (${res.status})`;
    throw new SigmaServiceError(detail, res.status === 400 || res.status === 422 ? 422 : 502);
  }
  return body as T;
}

export function getSigmaTargets(): Promise<SigmaTarget[]> {
  return callService<SigmaTarget[]>('/targets');
}

export function convertSigma(
  rule: string,
  target: string
): Promise<{ target: SigmaTarget; queries: string[]; pipelineApplied: boolean }> {
  return callService('/convert', { method: 'POST', body: JSON.stringify({ rule, target }) });
}
