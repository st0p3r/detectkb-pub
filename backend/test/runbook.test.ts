import { describe, expect, it } from 'vitest';
import { importedGuide, nextReviewDate, overview, section } from '../src/lib/runbook';
import { reviewWhere, ruleWhere, parseRuleListQuery } from '../src/lib/rule-list';

const elastic = `Identifies access to LSASS.

## Investigation guide

### Triage and analysis

### Investigating LSASS access

Some background.

#### Possible investigation steps

- Check the process tree.
- Look at the user.

#### False positive analysis

- Backup agents.

#### Response and remediation

- Isolate the host.

## Setup

Enable Sysmon.
`;

describe('runbook', () => {
  it('takes the overview and sections from a page body', () => {
    expect(overview(elastic)).toBe('Identifies access to LSASS.');
    expect(overview('## Only a heading\n\ntext')).toBe('');
    expect(overview('Detects X.\n**Author:** me\n**Sigma ID:** 1\n_Imported from Sigma._')).toBe('Detects X.');
    expect(section(elastic, /^setup$/i)).toBe('Enable Sysmon.');
    expect(section(elastic, /^nothing$/i)).toBeNull();
  });

  it('splits an imported investigation guide into triage and response', () => {
    expect(importedGuide(elastic)).toEqual({ triage: '- Check the process tree.\n- Look at the user.', response: '- Isolate the host.' });
    expect(importedGuide('No guide here.')).toEqual({ triage: null, response: null });
  });

  it('uses a guide without the usual parts whole, without its false positives', () => {
    const md = '## Investigation guide\n\nLook at the parent process.\n\n### False positive analysis\n\n- Admin scripts.\n\n## Source\n\nx';
    expect(importedGuide(md)).toEqual({ triage: 'Look at the parent process.', response: null });
  });

  it('schedules the next review', () => {
    expect(nextReviewDate(new Date('2026-01-01T00:00:00Z'), 30).toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
});

describe('rule list: owner and review filters', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('builds the review filter', () => {
    expect(reviewWhere('overdue', now)).toEqual({ nextReviewAt: { lt: now } });
    expect(reviewWhere('soon', now)).toEqual({ nextReviewAt: { lt: new Date('2026-07-01T00:00:00Z') } });
    expect(reviewWhere('none', now)).toEqual({ nextReviewAt: null });
    expect(reviewWhere('whatever', now)).toBeNull();
  });

  it('filters by owner and by the pages a route resolved', () => {
    expect(ruleWhere(parseRuleListQuery({ owner: 'none' }))).toEqual({ AND: [{ ownerId: null }] });
    expect(ruleWhere(parseRuleListQuery({ owner: '7' }))).toEqual({ AND: [{ ownerId: 7 }] });
    // "me" is resolved by the route; unresolved it filters nothing
    expect(ruleWhere(parseRuleListQuery({ owner: 'me' }))).toEqual({});
    expect(ruleWhere({ ...parseRuleListQuery({}), pageIds: [1, 2] })).toEqual({ AND: [{ pageId: { in: [1, 2] } }] });
  });
});
