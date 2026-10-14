import { describe, expect, it } from 'vitest';
import { convertStixBundle, summary } from '../src/lib/attack-stix';
import { compareVersions } from '../src/lib/attack-update';
import { ATTACK_VERSION, TECHNIQUE_BY_ID, findTactic, resolveTechniqueId, setAttackData } from '../src/lib/attack';
import { GROUP_BY_ID, GROUPS_BY_TECHNIQUE, setCtiData } from '../src/lib/attack-cti';

const ref = (id: string) => [{ source_name: 'mitre-attack', external_id: id }];
const bundle = {
  type: 'bundle',
  objects: [
    { type: 'x-mitre-collection', id: 'x-mitre-collection--1', x_mitre_version: '99.1' },
    { type: 'x-mitre-matrix', id: 'x-mitre-matrix--1', external_references: ref('enterprise-attack'), tactic_refs: ['x-mitre-tactic--ex', 'x-mitre-tactic--gone'] },
    { type: 'x-mitre-tactic', id: 'x-mitre-tactic--ex', name: 'Execution', x_mitre_shortname: 'execution', external_references: ref('TA0002') },
    { type: 'x-mitre-tactic', id: 'x-mitre-tactic--gone', name: 'Old', x_mitre_shortname: 'old', x_mitre_deprecated: true, external_references: ref('TA0099') },
    {
      type: 'attack-pattern',
      id: 'attack-pattern--ps',
      name: 'PowerShell',
      external_references: ref('T1059.001'),
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
    },
    { type: 'attack-pattern', id: 'attack-pattern--csi', name: 'Command and Scripting Interpreter', external_references: ref('T1059'), kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }] },
    { type: 'attack-pattern', id: 'attack-pattern--old', name: 'Old one', revoked: true, external_references: ref('T1086') },
    { type: 'relationship', id: 'relationship--r', relationship_type: 'revoked-by', source_ref: 'attack-pattern--old', target_ref: 'attack-pattern--ps' },
    {
      type: 'intrusion-set',
      id: 'intrusion-set--g',
      name: 'APT Test',
      aliases: ['APT Test', 'Testers'],
      description: 'Targets energy companies. (Citation: X) See [MITRE](https://attack.mitre.org).',
      external_references: ref('G9999'),
    },
    { type: 'tool', id: 'tool--t', name: 'TestTool', x_mitre_platforms: ['Windows'], external_references: ref('S9999') },
    { type: 'course-of-action', id: 'course-of-action--m', name: 'Execution Prevention', external_references: ref('M1038') },
    { type: 'relationship', id: 'relationship--u1', relationship_type: 'uses', source_ref: 'intrusion-set--g', target_ref: 'attack-pattern--ps' },
    { type: 'relationship', id: 'relationship--u2', relationship_type: 'uses', source_ref: 'intrusion-set--g', target_ref: 'tool--t' },
    { type: 'relationship', id: 'relationship--u3', relationship_type: 'uses', source_ref: 'tool--t', target_ref: 'attack-pattern--csi' },
    { type: 'relationship', id: 'relationship--m1', relationship_type: 'mitigates', source_ref: 'course-of-action--m', target_ref: 'attack-pattern--ps' },
    { type: 'relationship', id: 'relationship--u4', relationship_type: 'uses', source_ref: 'intrusion-set--g', target_ref: 'attack-pattern--old', revoked: true },
  ],
};

describe('ATT&CK STIX conversion', () => {
  it('extracts tactics, techniques, revoked IDs, groups, software and mitigations', () => {
    const d = convertStixBundle(bundle);
    expect(d.version).toBe('99.1');
    expect(d.tactics).toEqual([{ id: 'TA0002', shortname: 'execution', name: 'Execution' }]);
    expect(d.techniques.map((t) => t.id)).toEqual(['T1059', 'T1059.001']);
    expect(d.revoked).toEqual({ T1086: 'T1059.001' });
    expect(d.groups).toEqual([
      { id: 'G9999', name: 'APT Test', aliases: ['Testers'], description: 'Targets energy companies. See MITRE.', techniques: ['T1059.001'], software: ['S9999'] },
    ]);
    expect(d.software[0]).toMatchObject({ id: 'S9999', type: 'tool', platforms: ['Windows'], techniques: ['T1059'] });
    expect(d.mitigations[0]).toMatchObject({ id: 'M1038', techniques: ['T1059.001'] });
  });

  it('rejects files that are not the Enterprise bundle', () => {
    expect(() => convertStixBundle({ foo: 1 })).toThrow(/STIX bundle/);
    expect(() => convertStixBundle({ type: 'bundle', objects: [] })).toThrow(/Enterprise/);
  });

  it('shortens descriptions at a sentence', () => {
    expect(summary(`${'a'.repeat(200)}. ${'b'.repeat(300)}`, 420)).toBe(`${'a'.repeat(200)}.`);
  });

  it('compares versions numerically', () => {
    expect(compareVersions('19.2', '20.0')).toBeLessThan(0);
    expect(compareVersions('20.0', '19.10')).toBeGreaterThan(0);
    expect(compareVersions('19.10', '19.2')).toBeGreaterThan(0);
    expect(compareVersions('20', '20.0')).toBe(0);
    expect(compareVersions(null, '1.0')).toBeLessThan(0);
  });

  it('swaps the data in use in place', () => {
    const d = convertStixBundle(bundle);
    setAttackData(d);
    setCtiData(d);
    expect(ATTACK_VERSION).toBe('99.1');
    expect(TECHNIQUE_BY_ID.has('T1003')).toBe(false);
    expect(resolveTechniqueId('T1086')).toBe('T1059.001');
    expect(findTactic('execution')?.id).toBe('TA0002');
    expect(GROUP_BY_ID.get('G9999')?.name).toBe('APT Test');
    expect(GROUPS_BY_TECHNIQUE.get('T1059.001')?.map((g) => g.id)).toEqual(['G9999']);
  });
});
