import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseRuleFile } from '../src/lib/rule-import';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
const one = (name: string) => {
  const [entry] = parseRuleFile(name, fixture(name));
  expect(entry.error).toBeUndefined();
  return entry.rule!;
};

describe('Splunk ESCU', () => {
  it('maps the current layout', () => {
    const r = one('escu.yml');
    expect(r.format).toBe('escu');
    expect(r.externalId).toBe('fb4c31b0-13e8-4155-8aa5-24de4b8d6717');
    expect(r.sourceStatus).toBe('production');
    expect(r.severity).toBe('high'); // finding.entity.score 72
    expect(r.mitreTechniques).toBe('T1003.001');
    expect(r.splQuery).toContain('`sysmon` EventCode=10');
    expect(r.dataSource).toBe('Sysmon EventID 10');
    expect(r.contentMd).toContain('How to implement');
    expect(r.contentMd).toContain('windows-sysmon.log'); // attack_data test link kept
    expect(r.nativeQuery).toBeNull();
  });

  it('maps the legacy tags layout; hunting searches are info', () => {
    const r = one('escu-legacy.yml');
    expect(r.mitreTechniques).toBe('T1059.001');
    expect(r.sourceStatus).toBe('testing');
    expect(r.severity).toBe('info');
  });
});

describe('Elastic detection-rules', () => {
  it('maps TOML rules with ATT&CK threat blocks', () => {
    const r = one('elastic.toml');
    expect(r.format).toBe('elastic');
    expect(r.externalId).toBe('00140285-b827-4aee-aa09-8113f58a08f3');
    expect(r.severity).toBe('high');
    expect(r.mitreTactics).toBe('TA0006');
    expect(r.mitreTechniques).toBe('T1003, T1003.001');
    expect(r.nativeLanguage).toBe('eql');
    expect(r.nativeQuery).toContain('procdump.exe');
    expect(r.dataSource).toBe('Sysmon, Elastic Defend');
    expect(r.contentMd).toContain('Investigation guide');
    expect(r.splQuery).toBe('');
  });

  it('reports invalid TOML instead of throwing', () => {
    const [e] = parseRuleFile('bad.toml', '[rule\nname=');
    expect(e.error).toBeTruthy();
  });
});

describe('Microsoft Sentinel', () => {
  it('maps analytics rules', () => {
    const r = one('sentinel.yaml');
    expect(r.format).toBe('sentinel');
    expect(r.severity).toBe('medium');
    expect(r.mitreTactics).toBe('TA0005, TA0006'); // DefenseEvasion → legacy alias of TA0005
    expect(r.mitreTechniques).toBe('T1070');
    expect(r.nativeLanguage).toBe('kql');
    expect(r.dataSource).toBe('SecurityEvent');
  });
});

describe('Sigma', () => {
  it('parses multi-document files and reports broken documents', () => {
    const entries = parseRuleFile('sigma-multi.yml', fixture('sigma-multi.yml'));
    expect(entries).toHaveLength(2);
    expect(entries[0].rule?.format).toBe('sigma');
    expect(entries[0].rule?.severity).toBe('critical');
    expect(entries[0].rule?.sourceStatus).toBe('production');
    expect(entries[0].rule?.sigmaYaml).toContain('msagent_');
    expect(entries[1].error).toMatch(/detection/);
  });
});

it('rejects unknown YAML', () => {
  const [e] = parseRuleFile('x.yml', 'foo: bar\n');
  expect(e.error).toMatch(/Unrecognised format/);
});

it('fits long values into database columns and keeps the full list in the page', () => {
  const sources = Array.from({ length: 40 }, (_, i) => `    - Windows Event Log Security ${4600 + i}`).join('\n');
  const yml = `name: Many sources\nid: x-1\nstatus: production\nsearch: '| from datamodel'\nhow_to_implement: n/a\nmitre_attack_id: [T1059]\ndata_source:\n${sources}\n`;
  const [e] = parseRuleFile('many.yml', yml);
  expect(e.rule!.dataSource!.length).toBeLessThanOrEqual(255);
  expect(e.rule!.contentMd).toContain('Windows Event Log Security 4639');
});
