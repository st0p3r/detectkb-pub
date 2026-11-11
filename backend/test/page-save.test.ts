import { describe, expect, it } from 'vitest';
import { REVISION_RULE_FIELDS, changedParts, ruleSnapshot } from '../src/lib/page-save';

describe('page history', () => {
  it('keeps the rule fields that make the detection', () => {
    const snap = ruleSnapshot({ id: 5, pageId: 9, status: 'draft', severity: 'high', splQuery: 'index=x', ownerId: 3, sigmaId: 'abc' });
    expect(Object.keys(snap!)).toEqual([...REVISION_RULE_FIELDS]);
    expect(snap).toMatchObject({ status: 'draft', splQuery: 'index=x', triage: null });
    expect(ruleSnapshot(null)).toBeNull();
  });

  it('says what changed between two versions', () => {
    const a = { title: 'A', contentMd: 'one\r\n', rule: ruleSnapshot({ status: 'draft', severity: 'low', splQuery: 'q1' }) };
    expect(changedParts(a, { ...a, contentMd: 'one' })).toEqual([]);
    expect(changedParts(a, { ...a, title: 'B', contentMd: 'two' })).toEqual(['title', 'content']);
    expect(changedParts(a, { ...a, rule: { ...a.rule, splQuery: 'q2', status: 'production' } })).toEqual(['status', 'splQuery']);
    // A page that became a rule
    expect(changedParts({ ...a, rule: null }, a)).toEqual(['status', 'severity', 'splQuery']);
  });
});
