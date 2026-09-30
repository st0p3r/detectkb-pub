import { describe, expect, it } from 'vitest';
import { GROUP_BY_ID, GROUPS, MITIGATIONS, SOFTWARE, actorCoverage } from '../src/lib/attack-cti';
import { TECHNIQUE_BY_ID } from '../src/lib/attack';
import { parseStoryYaml, ruleStoryNames, storyFileName } from '../src/lib/stories';
import { parseD3fendResponse } from '../src/lib/d3fend';

describe('ATT&CK CTI data', () => {
  it('has groups, software and mitigations mapped to current techniques', () => {
    expect(GROUPS.length).toBeGreaterThan(100);
    expect(SOFTWARE.length).toBeGreaterThan(500);
    expect(MITIGATIONS.length).toBeGreaterThan(30);
    const oilrig = GROUP_BY_ID.get('G0049')!;
    expect(oilrig.name).toBe('OilRig');
    expect(oilrig.aliases).toContain('APT34');
    for (const t of [...GROUPS, ...SOFTWARE, ...MITIGATIONS].flatMap((x) => x.techniques)) expect(TECHNIQUE_BY_ID.has(t)).toBe(true);
    expect(oilrig.description).not.toMatch(/\(Citation:|\]\(https?:/);
  });
});

describe('actorCoverage', () => {
  const rules = new Map<string, Set<number>>([
    ['T1003', new Set([1])], // parent only
    ['T1059.001', new Set([2, 3])],
  ]);

  it('counts a parent covered by its sub-techniques, and a sub-technique covered only by its parent as "parent"', () => {
    const c = actorCoverage(['T1003.001', 'T1059', 'T1059.001', 'T1105'], rules);
    expect(c.techniques.map((t) => [t.id, t.state, t.rules])).toEqual([
      ['T1003.001', 'parent', 1],
      ['T1059', 'covered', 2],
      ['T1059.001', 'covered', 2],
      ['T1105', 'none', 0],
    ]);
    expect([c.total, c.covered, c.parentOnly, c.pct]).toEqual([4, 2, 1, 50]);
  });
});

describe('analytic stories', () => {
  it('reads story names of ESCU detections (current and older layouts)', () => {
    expect(ruleStoryNames('escu', 'name: x\nanalytic_story:\n  - Volt Typhoon\n  - Volt Typhoon\nsearch: x')).toEqual(['Volt Typhoon']);
    expect(ruleStoryNames('escu', 'name: x\ntags:\n  analytic_story:\n    - Ransomware\nsearch: x')).toEqual(['Ransomware']);
    expect(ruleStoryNames('sigma', 'analytic_story: [x]')).toEqual([]);
    expect(ruleStoryNames('escu', ': not yaml :')).toEqual([]);
  });

  it('parses story files, not detections', () => {
    const story = parseStoryYaml(
      'name: Volt Typhoon\nid: abc\ndescription: A group.\nnarrative: Long text.\nreferences:\n  - https://x\ncategory:\n  - Adversary Tactics\nusecase: Advanced Threat Detection\n'
    );
    expect(story).toMatchObject({
      name: 'Volt Typhoon',
      externalId: 'abc',
      description: 'A group.',
      narrative: 'Long text.',
      references: ['https://x'],
      category: 'Adversary Tactics',
    });
    expect(parseStoryYaml('name: Detection\ndescription: x\nsearch: index=x')).toBeNull();
  });

  it('builds the file name security_content uses', () => {
    expect(storyFileName('Masquerading - Rename System Utilities')).toBe('masquerading___rename_system_utilities.yml');
    expect(storyFileName('Scattered Lapsus$ Hunters')).toBe('scattered_lapsus$_hunters.yml');
  });
});

describe('parseD3fendResponse', () => {
  it('reads countermeasures from SPARQL-style bindings, unique by name', () => {
    const b = (tech: string, label: string, tactic: string) => ({
      def_tech: { type: 'uri', value: `http://d3fend.mitre.org/ontologies/d3fend.owl#${tech}` },
      def_tech_label: { type: 'literal', value: label },
      def_tactic_label: { type: 'literal', value: tactic },
      def_artifact_label: { type: 'literal', value: 'Process' },
    });
    const json = {
      off_to_def: {
        head: { vars: ['def_tech', 'def_tech_label'] },
        results: { bindings: [b('ProcessSpawnAnalysis', 'Process Spawn Analysis', 'Detect'), b('CredentialHardening', 'Credential Hardening', 'Harden'), b('CredentialHardening', 'Credential Hardening', 'Harden')] },
      },
    };
    expect(parseD3fendResponse(json)).toEqual([
      { name: 'Process Spawn Analysis', tactic: 'Detect', artifact: 'Process', url: 'https://d3fend.mitre.org/technique/d3f:ProcessSpawnAnalysis/' },
      { name: 'Credential Hardening', tactic: 'Harden', artifact: 'Process', url: 'https://d3fend.mitre.org/technique/d3f:CredentialHardening/' },
    ]);
    expect(parseD3fendResponse({ nothing: true })).toEqual([]);
  });
});
