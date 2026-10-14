import { describe, expect, it } from 'vitest';
import { techniquePageWhere, techniqueRows } from '../src/lib/rule-techniques';
import { bestConfidence, ruleConfidence } from '../src/lib/coverage-confidence';

describe('techniqueRows', () => {
  it('keeps the ID as written and resolves retired and sub-technique IDs', () => {
    expect(techniqueRows(7, 't1003.001, T1562, T1059, T9999, T1059')).toEqual([
      { pageId: 7, rawId: 'T1003.001', techniqueId: 'T1003.001', parentId: 'T1003' },
      { pageId: 7, rawId: 'T1562', techniqueId: 'T1685', parentId: 'T1685' },
      { pageId: 7, rawId: 'T1059', techniqueId: 'T1059', parentId: 'T1059' },
      { pageId: 7, rawId: 'T9999', techniqueId: null, parentId: null },
    ]);
    expect(techniqueRows(1, null)).toEqual([]);
  });

  it('finds a technique, its sub-techniques and retired IDs replaced by it', () => {
    expect(techniquePageWhere(' t1003 ')).toEqual({
      techniques: { some: { OR: [{ techniqueId: 'T1003' }, { parentId: 'T1003' }, { rawId: 'T1003' }] } },
    });
  });
});

describe('coverage confidence', () => {
  it('ranks lab-proven deployed rules over production, testing and drafts', () => {
    expect(ruleConfidence({ status: 'production', validation: 'validated' })).toBe('validated');
    expect(ruleConfidence({ status: 'testing', validation: 'validated' })).toBe('validated');
    expect(ruleConfidence({ status: 'draft', validation: 'validated' })).toBe('draft');
    expect(ruleConfidence({ status: 'production', validation: 'failed' })).toBe('production');
    expect(ruleConfidence({ status: 'deprecated' })).toBeNull();
    expect(bestConfidence([{ status: 'draft' }, { status: 'testing' }, { status: 'deprecated' }])).toBe('testing');
    expect(bestConfidence([{ status: 'deprecated' }])).toBeNull();
    expect(bestConfidence([])).toBeNull();
  });
});
