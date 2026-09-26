import { parse as parseToml } from 'smol-toml';
import { findTactic, parseTechniqueIds } from './attack';
import { SigmaDoc, parseSigmaDocuments, sigmaToRuleFields, validateSigmaRule } from './sigma';

// Parsers for rule formats DetectKB can import, all normalised to ImportedRule:
//   sigma    — Sigma YAML (SigmaHQ)
//   escu     — Splunk ESCU detections YAML (github.com/splunk/security_content)
//   elastic  — Elastic detection-rules TOML (github.com/elastic/detection-rules)
//   sentinel — Microsoft Sentinel analytics rule YAML (github.com/Azure/Azure-Sentinel)

export type ImportFormat = 'sigma' | 'escu' | 'elastic' | 'sentinel';

export const FORMAT_LABELS: Record<ImportFormat, string> = {
  sigma: 'Sigma',
  escu: 'Splunk ESCU',
  elastic: 'Elastic detection-rules',
  sentinel: 'Microsoft Sentinel',
};

/** Page tag added to imported rules, per format. */
export const FORMAT_TAGS: Record<ImportFormat, string> = {
  sigma: 'sigma',
  escu: 'splunk-escu',
  elastic: 'elastic',
  sentinel: 'sentinel',
};

export interface ImportedRule {
  format: ImportFormat;
  externalId: string | null;
  title: string;
  contentMd: string;
  /** Status as declared by the source (mapped to DetectKB's statuses). */
  sourceStatus: string;
  severity: string;
  mitreTactics: string | null;
  mitreTechniques: string | null;
  dataSource: string | null;
  falsePositives: string | null;
  references: string | null;
  splQuery: string;
  nativeQuery: string | null;
  nativeLanguage: string | null;
  sigmaYaml: string | null;
  sourceContent: string;
}

export interface ParsedEntry {
  where: string;
  rule?: ImportedRule;
  error?: string;
}

type Obj = Record<string, unknown>;

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined).map(String) : v ? [String(v)] : [];
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());
const joinOrNull = (items: string[], sep: string) => (items.length ? items.join(sep) : null);
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function section(title: string, body: string): string {
  return body.trim() ? `\n## ${title}\n\n${body.trim()}\n` : '';
}

function tacticIds(names: string[]): string | null {
  const ids = Array.from(new Set(names.map((n) => findTactic(n)?.id).filter((id): id is string => !!id)));
  return joinOrNull(ids, ', ');
}

function techniqueList(ids: string[]): string | null {
  return joinOrNull(parseTechniqueIds(ids.join(' ')), ', ');
}

// ── Splunk ESCU ──────────────────────────────────────────────────────────────

const ESCU_STATUS: Record<string, string> = {
  production: 'production',
  experimental: 'testing',
  validation: 'testing',
  deprecated: 'deprecated',
  removed: 'deprecated',
};

/** ESCU risk score (0–100) → severity. */
function severityFromScore(score: number | null): string {
  if (score === null || isNaN(score)) return 'medium';
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  if (score >= 20) return 'low';
  return 'info';
}

function escuScore(doc: Obj): number | null {
  const tags = isObj(doc.tags) ? doc.tags : {};
  const scores: number[] = [];
  const entity = isObj(doc.finding) && isObj(doc.finding.entity) ? doc.finding.entity : null;
  if (entity && entity.score !== undefined) scores.push(Number(entity.score));
  if (isObj(doc.rba)) {
    for (const r of Array.isArray(doc.rba.risk_objects) ? doc.rba.risk_objects : []) {
      if (isObj(r) && r.score !== undefined) scores.push(Number(r.score));
    }
  }
  if (tags.risk_score !== undefined) scores.push(Number(tags.risk_score));
  const valid = scores.filter((n) => !isNaN(n));
  return valid.length ? Math.max(...valid) : null;
}

function isEscu(doc: Obj): boolean {
  const tags = isObj(doc.tags) ? doc.tags : {};
  return typeof doc.search === 'string' && typeof doc.name === 'string' &&
    (doc.how_to_implement !== undefined || doc.mitre_attack_id !== undefined || tags.mitre_attack_id !== undefined);
}

function parseEscu(doc: Obj, source: string): ImportedRule {
  const tags = isObj(doc.tags) ? doc.tags : {};
  const techniques = asList(doc.mitre_attack_id ?? tags.mitre_attack_id);
  const stories = asList(doc.analytic_story ?? tags.analytic_story);
  const tests = (Array.isArray(doc.tests) ? doc.tests : [])
    .flatMap((t) => (isObj(t) && Array.isArray(t.attack_data) ? t.attack_data : []))
    .map((d) => (isObj(d) ? str(d.data) : ''))
    .filter(Boolean);

  const content =
    str(doc.description) +
    section('How to implement', str(doc.how_to_implement)) +
    section('Data sources', asList(doc.data_source).map((s) => `- ${s}`).join('\n')) +
    section('Analytic stories', stories.map((s) => `- ${s}`).join('\n')) +
    section('Test data (from Splunk attack_data)', tests.map((u) => `- ${u}`).join('\n')) +
    section(
      'Source',
      [
        `Imported from **Splunk ESCU** (security_content).`,
        doc.type && `Type: ${doc.type}`,
        doc.version !== undefined && `Version: ${doc.version}`,
        doc.status && `Source status: ${doc.status}`,
        doc.author && `Author: ${doc.author}`,
        'The search uses ESCU macros (e.g. `sysmon`, `security_content_ctime`) that must exist in your Splunk.',
      ]
        .filter(Boolean)
        .join('  \n')
    );

  return {
    format: 'escu',
    externalId: str(doc.id) || null,
    title: str(doc.name),
    contentMd: content,
    sourceStatus: ESCU_STATUS[str(doc.status).toLowerCase()] ?? 'draft',
    // Hunting searches are run manually, not alerted on
    severity: str(doc.type) === 'Hunting' ? 'info' : severityFromScore(escuScore(doc)),
    mitreTactics: null,
    mitreTechniques: techniqueList(techniques),
    dataSource: joinOrNull(asList(doc.data_source), ', '),
    falsePositives: str(doc.known_false_positives) || null,
    references: joinOrNull(asList(doc.references), '\n'),
    splQuery: str(doc.search),
    nativeQuery: null,
    nativeLanguage: null,
    sigmaYaml: null,
    sourceContent: source,
  };
}

// ── Microsoft Sentinel ───────────────────────────────────────────────────────

const SENTINEL_SEVERITY: Record<string, string> = {
  informational: 'info',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

function isSentinel(doc: Obj): boolean {
  return typeof doc.query === 'string' && typeof doc.name === 'string' &&
    (doc.queryFrequency !== undefined || doc.requiredDataConnectors !== undefined ||
      doc.relevantTechniques !== undefined || doc.kind !== undefined);
}

/** "CredentialAccess" → "credential-access" */
const camelToShortname = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

function parseSentinel(doc: Obj, source: string): ImportedRule {
  const dataTypes = (Array.isArray(doc.requiredDataConnectors) ? doc.requiredDataConnectors : []).flatMap(
    (c) => (isObj(c) ? asList(c.dataTypes) : [])
  );
  const schedule = [
    doc.kind && `Kind: ${doc.kind}`,
    doc.queryFrequency && `Query frequency: ${doc.queryFrequency}`,
    doc.queryPeriod && `Query period: ${doc.queryPeriod}`,
    doc.triggerOperator && `Trigger: ${doc.triggerOperator} ${doc.triggerThreshold ?? ''}`,
  ].filter(Boolean);

  return {
    format: 'sentinel',
    externalId: str(doc.id) || null,
    title: str(doc.name),
    contentMd:
      str(doc.description).replace(/^'|'$/g, '') +
      section('Schedule', schedule.join('  \n')) +
      section(
        'Source',
        [
          'Imported from **Microsoft Sentinel** analytics rules.',
          doc.version && `Version: ${doc.version}`,
          doc.status && `Source status: ${doc.status}`,
        ]
          .filter(Boolean)
          .join('  \n')
      ),
    sourceStatus: str(doc.status).toLowerCase() === 'available' ? 'production' : 'draft',
    severity: SENTINEL_SEVERITY[str(doc.severity).toLowerCase()] ?? 'medium',
    mitreTactics: tacticIds(asList(doc.tactics).map(camelToShortname)),
    mitreTechniques: techniqueList(asList(doc.relevantTechniques)),
    dataSource: joinOrNull(Array.from(new Set(dataTypes)), ', '),
    falsePositives: null,
    references: null,
    splQuery: '',
    nativeQuery: str(doc.query),
    nativeLanguage: 'kql',
    sigmaYaml: null,
    sourceContent: source,
  };
}

// ── Elastic detection-rules (TOML) ───────────────────────────────────────────

const ELASTIC_MATURITY: Record<string, string> = {
  production: 'production',
  development: 'testing',
  deprecated: 'deprecated',
};
const ELASTIC_LANGUAGES = new Set(['eql', 'kuery', 'esql', 'lucene']);

function parseElastic(text: string): ImportedRule {
  const doc = parseToml(text) as Obj;
  const rule = isObj(doc.rule) ? doc.rule : null;
  const metadata = isObj(doc.metadata) ? doc.metadata : {};
  if (!rule || !rule.name) throw new Error('Not an Elastic detection rule (missing [rule] name)');

  const tactics: string[] = [];
  const techniques: string[] = [];
  for (const threat of Array.isArray(rule.threat) ? rule.threat : []) {
    if (!isObj(threat) || str(threat.framework) !== 'MITRE ATT&CK') continue;
    if (isObj(threat.tactic)) tactics.push(str(threat.tactic.id));
    for (const t of Array.isArray(threat.technique) ? threat.technique : []) {
      if (!isObj(t)) continue;
      techniques.push(str(t.id));
      for (const sub of Array.isArray(t.subtechnique) ? t.subtechnique : []) {
        if (isObj(sub)) techniques.push(str(sub.id));
      }
    }
  }

  const tags = asList(rule.tags);
  const dataSources = tags.filter((t) => t.startsWith('Data Source: ')).map((t) => t.slice('Data Source: '.length));
  const language = str(rule.language).toLowerCase();
  const query = str(rule.query);

  return {
    format: 'elastic',
    externalId: str(rule.rule_id) || null,
    title: str(rule.name),
    contentMd:
      str(rule.description) +
      section('Investigation guide', str(rule.note).replace(/^#{1,2} /gm, '### ')) +
      section('Setup', str(rule.setup)) +
      section(
        'Source',
        [
          'Imported from **Elastic detection-rules**.',
          `Rule type: ${rule.type ?? 'unknown'}`,
          rule.machine_learning_job_id && `Machine learning job: ${asList(rule.machine_learning_job_id).join(', ')}`,
          Array.isArray(rule.index) && `Index patterns: ${asList(rule.index).join(', ')}`,
          metadata.maturity && `Source maturity: ${metadata.maturity}`,
          rule.risk_score !== undefined && `Risk score: ${rule.risk_score}`,
        ]
          .filter(Boolean)
          .join('  \n')
      ),
    sourceStatus: ELASTIC_MATURITY[str(metadata.maturity).toLowerCase()] ?? 'draft',
    severity: ['low', 'medium', 'high', 'critical'].includes(str(rule.severity)) ? str(rule.severity) : 'medium',
    mitreTactics: joinOrNull(Array.from(new Set(tactics.filter(Boolean))), ', '),
    mitreTechniques: techniqueList(techniques),
    dataSource: joinOrNull(dataSources, ', '),
    falsePositives: joinOrNull(asList(rule.false_positives), '\n'),
    references: joinOrNull(asList(rule.references), '\n'),
    splQuery: '',
    nativeQuery: query || null,
    nativeLanguage: query ? (ELASTIC_LANGUAGES.has(language) ? language : language || null) : null,
    sigmaYaml: null,
    sourceContent: text,
  };
}

// ── Sigma ────────────────────────────────────────────────────────────────────

function parseSigma(doc: SigmaDoc, source: string): ImportedRule {
  const f = sigmaToRuleFields(doc);
  return {
    format: 'sigma',
    externalId: f.sigmaId,
    title: f.title,
    contentMd: f.contentMd,
    sourceStatus: f.status,
    severity: f.severity,
    mitreTactics: f.mitreTactics,
    mitreTechniques: f.mitreTechniques,
    dataSource: f.dataSource,
    falsePositives: f.falsePositives,
    references: f.references,
    splQuery: '',
    nativeQuery: null,
    nativeLanguage: null,
    sigmaYaml: source,
    sourceContent: source,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

const clip = (s: string | null, max: number) => (s && s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Fits values into the database columns (Page.title and DetectionRule.dataSource are VARCHAR(255)). */
function fitColumns(rule: ImportedRule): ImportedRule {
  return { ...rule, title: clip(rule.title, 255)!, dataSource: clip(rule.dataSource, 255), externalId: clip(rule.externalId, 128) };
}

/** Parses one uploaded file into zero or more rules, detecting the format per document. */
export function parseRuleFile(name: string, content: string): ParsedEntry[] {
  if (/\.toml$/i.test(name)) {
    try {
      return [{ where: name, rule: fitColumns(parseElastic(content)) }];
    } catch (err) {
      return [{ where: name, error: (err as Error).message }];
    }
  }

  const docs = parseSigmaDocuments(content);
  if (docs.length === 0) return [{ where: name, error: 'No YAML documents found' }];

  return docs.map(({ doc, error, source }, i) => {
    const where = docs.length > 1 ? `${name} (document ${i + 1})` : name;
    if (error || !doc) return { where, error: error ?? 'Empty document' };
    try {
      if (doc.detection !== undefined || doc.logsource !== undefined) {
        const problem = validateSigmaRule(doc);
        return problem ? { where, error: problem } : { where, rule: fitColumns(parseSigma(doc, source)) };
      }
      if (isEscu(doc)) return { where, rule: fitColumns(parseEscu(doc, source)) };
      if (isSentinel(doc)) return { where, rule: fitColumns(parseSentinel(doc, source)) };
      if (doc.id && doc.name && !doc.query && /moved to (?:a )?new location/i.test(str(doc.description))) {
        return { where, error: 'Sentinel placeholder: the rule was moved elsewhere in the repository (no query)' };
      }
      return { where, error: 'Unrecognised format (expected Sigma, Splunk ESCU or Sentinel YAML, or Elastic TOML)' };
    } catch (err) {
      return { where, error: (err as Error).message };
    }
  });
}
