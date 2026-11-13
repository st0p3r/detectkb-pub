import { describe, expect, it } from 'vitest';
import { collectionActive, feedSummary, fieldState, keyState, missingKeys, opportunities, ruleFeed } from '../src/lib/collection';
import type { RuleTelemetry } from '../src/lib/coverage-analysis';

const rule = (o: Partial<RuleTelemetry> & { pageId: number }): RuleTelemetry => ({
  title: `Rule ${o.pageId}`,
  slug: `rule-${o.pageId}`,
  status: 'production',
  severity: 'medium',
  sourceFormat: 'sigma',
  dataSource: null,
  techniques: [],
  sysmon: [],
  telemetry: [],
  groups: [],
  ...o,
});

describe('what is collected', () => {
  it('an event follows its source unless it has its own answer', () => {
    const map = new Map([
      ['sysmon', true],
      ['sysmon:10', false],
      ['windows-security', false],
      ['windows-security:4688', true],
    ]);
    expect(keyState(map, 'sysmon:1')).toBe('collected');
    expect(keyState(map, 'sysmon:10')).toBe('not-collected');
    expect(keyState(map, 'windows-security:4624')).toBe('not-collected');
    expect(keyState(map, 'windows-security:4688')).toBe('collected');
    expect(keyState(map, 'auditd:execve')).toBe('unknown');
    expect(keyState(map, 'auditd')).toBe('unknown');
  });

  it('a rule is fed when one way to feed it is fully collected', () => {
    const map = new Map([
      ['sysmon', true],
      ['windows-security', false],
    ]);
    // Either event feeds it
    expect(ruleFeed(rule({ pageId: 1, telemetry: ['sysmon:1', 'windows-security:4688'] }), map)).toBe('fed');
    // Both needed at once: one is missing
    expect(ruleFeed(rule({ pageId: 2, telemetry: ['sysmon:1', 'windows-security:4688'], groups: [['sysmon:1', 'windows-security:4688']] }), map)).toBe('blind');
    expect(ruleFeed(rule({ pageId: 3, telemetry: ['windows-security:4688'] }), map)).toBe('blind');
    expect(missingKeys(rule({ pageId: 3, telemetry: ['sysmon:1', 'windows-security:4688'] }), map)).toEqual(['windows-security:4688']);
  });

  it('stays unknown when nothing is decided, or the rule may be fed some other way', () => {
    const map = new Map([['windows-security', false]]);
    expect(ruleFeed(rule({ pageId: 1, telemetry: ['windows-security:4688'] }), new Map())).toBe('unknown');
    expect(ruleFeed(rule({ pageId: 2 }), map)).toBe('unknown');
    expect(ruleFeed(rule({ pageId: 3, telemetry: ['auditd:execve'] }), map)).toBe('unknown');
    // One alternative is gone, the other isn't decided
    expect(ruleFeed(rule({ pageId: 4, telemetry: ['windows-security:4688', 'auditd:execve'] }), map)).toBe('unknown');
    // Names a data source DetectKB can't map
    expect(ruleFeed(rule({ pageId: 5, sourceFormat: null, dataSource: 'Winlogbeat', telemetry: ['windows-security:4688'] }), map)).toBe('unknown');
  });

  it('field answers alone say nothing about which logs arrive', () => {
    const map = new Map([['field:parentcommandline', false]]);
    expect(collectionActive(map)).toBe(false);
    expect(ruleFeed(rule({ pageId: 1, telemetry: ['sysmon:1'] }), map)).toBe('unknown');
    expect(fieldState(map, 'ParentCommandLine')).toBe('not-collected');
    expect(fieldState(map, 'Image')).toBe('unknown');
    expect(collectionActive(new Map([...map, ['sysmon', true]]))).toBe(true);
  });

  it('counts rules by feed, ignoring deprecated ones', () => {
    const map = new Map([
      ['sysmon', true],
      ['windows-security', false],
    ]);
    const rules = [
      rule({ pageId: 1, telemetry: ['sysmon:1'] }),
      rule({ pageId: 2, telemetry: ['windows-security:4688'] }),
      rule({ pageId: 3, status: 'draft', telemetry: ['windows-security:4688'] }),
      rule({ pageId: 4, status: 'deprecated', telemetry: ['windows-security:4688'] }),
      rule({ pageId: 5 }),
    ];
    expect(feedSummary(rules, map)).toEqual({ fed: 1, blind: 2, unknown: 1, blindDeployed: 1, blindProduction: 1 });
  });

  it('finds drafts that can run today and the sources worth collecting', () => {
    const map = new Map([
      ['sysmon', true],
      ['windows-security', false],
    ]);
    const rules = [
      // Deployed and fed: T1059 is covered
      rule({ pageId: 1, telemetry: ['sysmon:1'], techniques: ['T1059.001'] }),
      // Deployed but blind: T1003 is not really covered
      rule({ pageId: 2, telemetry: ['windows-security:4656'], techniques: ['T1003.001'] }),
      // Drafts with logs: one closes the T1003 gap, one only adds depth
      rule({ pageId: 3, status: 'draft', severity: 'low', telemetry: ['sysmon:1'], techniques: ['T1059.003'] }),
      rule({ pageId: 4, status: 'draft', severity: 'high', telemetry: ['sysmon:10'], techniques: ['T1003.001'] }),
      // A draft without logs
      rule({ pageId: 5, status: 'draft', telemetry: ['windows-security:4688'], techniques: ['T1053.005'] }),
    ];
    const { ready, sources } = opportunities(rules, map);
    expect(ready.map((r) => [r.pageId, r.fills])).toEqual([
      [4, ['T1003']],
      [3, []],
    ]);
    expect(sources).toEqual([{ source: 'windows-security', state: 'not-collected', rules: 2, deployedRules: 1, techniques: ['T1003', 'T1053'] }]);
  });
});
