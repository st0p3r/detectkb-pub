import { describe, expect, it } from 'vitest';
import { diffImportedRule, type ExistingRule } from '../src/lib/rule-import-diff';
import type { ImportedRule } from '../src/lib/rule-import';

const imported = (over: Partial<ImportedRule> = {}): ImportedRule => ({
  format: 'escu',
  externalId: 'abc',
  title: 'Suspicious LSASS Access',
  contentMd: 'Detects access to LSASS.',
  sourceStatus: 'production',
  severity: 'high',
  mitreTactics: 'TA0006',
  mitreTechniques: 'T1003.001',
  dataSource: 'Sysmon EventID 10',
  falsePositives: null,
  references: null,
  splQuery: '`sysmon` EventCode=10 TargetImage=*lsass.exe',
  nativeQuery: null,
  nativeLanguage: null,
  sigmaYaml: null,
  sourceContent: 'name: Suspicious LSASS Access',
  ...over,
});

const existing = (over: Partial<ExistingRule> = {}): ExistingRule => ({
  splQuery: '`sysmon` EventCode=10 TargetImage=*lsass.exe',
  severity: 'high',
  mitreTactics: 'TA0006',
  mitreTechniques: 'T1003.001',
  dataSource: 'Sysmon EventID 10',
  falsePositives: '',
  references: null,
  sigmaYaml: null,
  nativeQuery: null,
  page: { title: 'Suspicious LSASS Access', contentMd: 'Detects access to LSASS.\r\n' },
  ...over,
});

describe('diffImportedRule', () => {
  it('reports nothing when only whitespace, line endings or null/empty differ', () => {
    expect(diffImportedRule(imported(), existing())).toEqual([]);
  });

  it('lists the fields that changed, with before and after', () => {
    const changes = diffImportedRule(imported({ severity: 'critical', mitreTechniques: 'T1003.001, T1003.002' }), existing());
    expect(changes.map((c) => c.field)).toEqual(['severity', 'mitreTechniques']);
    expect(changes[0]).toMatchObject({ label: 'Severity', before: 'high', after: 'critical' });
  });

  it('compares the Sigma source, not the SPL generated from it', () => {
    const sigma = imported({ format: 'sigma', splQuery: '', sigmaYaml: 'title: x\nlevel: high' });
    expect(diffImportedRule(sigma, existing({ splQuery: 'generated SPL', sigmaYaml: 'title: x\nlevel: high' }))).toEqual([]);
    expect(diffImportedRule(sigma, existing({ sigmaYaml: 'title: x\nlevel: medium' })).map((c) => c.field)).toEqual(['sigmaYaml']);
  });

  it('does not count a missing SPL in the source as a change', () => {
    expect(diffImportedRule(imported({ format: 'elastic', splQuery: '' }), existing({ splQuery: 'kept' }))).toEqual([]);
  });
});
