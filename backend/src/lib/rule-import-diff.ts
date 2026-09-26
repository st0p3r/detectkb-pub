import type { ImportedRule } from './rule-import';

// What an import would change on a rule that was imported before.

export interface ExistingRule {
  splQuery: string;
  severity: string;
  mitreTactics: string | null;
  mitreTechniques: string | null;
  dataSource: string | null;
  falsePositives: string | null;
  references: string | null;
  sigmaYaml: string | null;
  nativeQuery: string | null;
  page: { title: string; contentMd: string };
}

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

const norm = (v: string | null | undefined) => (v ?? '').replace(/\r\n/g, '\n').trim();

/**
 * Fields of `existing` the imported rule would change. Status is left out (it
 * is managed here, not by the source), and so is a Sigma rule's SPL: it is
 * generated from the Sigma source, which is compared instead.
 */
export function diffImportedRule(rule: ImportedRule, existing: ExistingRule): FieldChange[] {
  const fields: [string, string, string | null | undefined, string | null | undefined][] = [
    ['title', 'Title', existing.page.title, rule.title],
    ['severity', 'Severity', existing.severity, rule.severity],
    ['mitreTechniques', 'ATT&CK techniques', existing.mitreTechniques, rule.mitreTechniques],
    ['mitreTactics', 'ATT&CK tactics', existing.mitreTactics, rule.mitreTactics],
    ['dataSource', 'Data source', existing.dataSource, rule.dataSource],
    ['falsePositives', 'False positives', existing.falsePositives, rule.falsePositives],
    ['references', 'References', existing.references, rule.references],
    ['contentMd', 'Description', existing.page.contentMd, rule.contentMd],
    rule.format === 'sigma'
      ? ['sigmaYaml', 'Sigma source', existing.sigmaYaml, rule.sigmaYaml]
      : ['splQuery', 'SPL query', existing.splQuery, rule.splQuery],
    ['nativeQuery', `${rule.nativeLanguage?.toUpperCase() ?? 'Native'} query`, existing.nativeQuery, rule.nativeQuery],
  ];
  return fields
    .filter(([field, , before, after]) => norm(before) !== norm(after) && !(field === 'splQuery' && !norm(after)))
    .map(([field, label, before, after]) => ({ field, label, before: norm(before), after: norm(after) }));
}
