import { describe, expect, it } from 'vitest';
import { ruleQueryHash, toSavedSearches, validationStatus, VALIDATION_MAX_AGE_DAYS } from '../src/lib/validation';

const now = new Date('2026-10-01T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);
const H = ruleQueryHash('index=win EventCode=4688');

describe('validationStatus', () => {
  it('is never tested without decisive runs', () => {
    expect(validationStatus([], H, now).status).toBe('never');
    // blocked / error: the attack never really ran
    expect(validationStatus([{ result: 'blocked', executedAt: daysAgo(1), queryHash: H }], H, now).status).toBe('never');
  });

  it('follows the latest decisive run', () => {
    const runs = [
      { result: 'not-detected', executedAt: daysAgo(10), queryHash: H },
      { result: 'detected', executedAt: daysAgo(2), queryHash: H },
      { result: 'error', executedAt: daysAgo(1), queryHash: H },
    ];
    expect(validationStatus(runs, H, now)).toMatchObject({ status: 'validated', lastRun: { result: 'detected' } });
    expect(validationStatus([...runs, { result: 'not-detected', executedAt: daysAgo(1), queryHash: H }], H, now).status).toBe('failed');
    expect(validationStatus([{ result: 'partial', executedAt: daysAgo(1), queryHash: H }], H, now).status).toBe('partial');
  });

  it('lets the run recorded later win a tie on time', () => {
    const at = daysAgo(1);
    const runs = [
      { result: 'not-detected', executedAt: at, queryHash: H, createdAt: new Date(now.getTime() - 60000) },
      { result: 'detected', executedAt: at, queryHash: H, createdAt: now },
    ];
    expect(validationStatus(runs, H, now).status).toBe('validated');
    expect(validationStatus([...runs].reverse(), H, now).status).toBe('validated');
  });

  it('goes stale when the query changes or the result ages', () => {
    const run = { result: 'detected', executedAt: daysAgo(1), queryHash: H };
    expect(validationStatus([run], ruleQueryHash('index=win EventCode=4689'), now)).toMatchObject({ status: 'stale', reason: 'query-changed' });
    expect(validationStatus([{ ...run, executedAt: daysAgo(VALIDATION_MAX_AGE_DAYS + 1) }], H, now)).toMatchObject({ status: 'stale', reason: 'too-old' });
  });

  it('ignores line endings and surrounding whitespace in the query hash', () => {
    expect(ruleQueryHash('a\r\nb  \n')).toBe(ruleQueryHash('a\nb'));
  });
});

describe('toSavedSearches', () => {
  const conf = toSavedSearches(
    [
      { pageId: 1, title: 'LSASS [dump]', slug: 'lsass', severity: 'high', techniques: ['T1003.001'], splQuery: '`sysmon` EventCode=10\n| stats count by host  ' },
      { pageId: 2, title: 'LSASS [dump]', slug: 'lsass-2', severity: 'weird', techniques: [], splQuery: 'index=win' },
    ],
    now
  );

  it('writes one stanza per rule with multi-line searches continued by backslashes', () => {
    expect(conf).toContain('[DetectKB - LSASS dump]\n');
    expect(conf).toContain('search = `sysmon` EventCode=10 \\\n| stats count by host\n');
    expect(conf).toContain('description = DetectKB rule 1 (lsass) · T1003.001');
    expect(conf).toContain('alert.severity = 4');
  });

  it('keeps stanza names unique and defaults unknown severities', () => {
    expect(conf).toContain('[DetectKB - LSASS dump (2)]');
    expect(conf.split('[DetectKB - LSASS dump (2)]')[1]).toContain('alert.severity = 3');
  });
});
