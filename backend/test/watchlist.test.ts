import { describe, expect, it } from 'vitest';
import { fillsTechnique, prioritize } from '../src/lib/watchlist';

const rule = (pageId: number, status: string, techniques: string[], severity = 'medium') => ({
  pageId,
  title: `Rule ${pageId}`,
  slug: `r${pageId}`,
  status,
  severity,
  techniques,
});

describe('watchlist priorities', () => {
  it('counts sub-technique rules for a parent technique, not the other way round', () => {
    expect(fillsTechnique('T1003', 'T1003.001')).toBe(true);
    expect(fillsTechnique('T1003.001', 'T1003')).toBe(false);
    expect(fillsTechnique('T1003.001', 'T1003.001')).toBe(true);
  });

  it('ranks gaps of more watched groups first, and drafts by the groups whose gaps they close', () => {
    const groups = [
      { id: 'G1', techniques: ['T1003.001', 'T1059.001', 'T1105'] },
      { id: 'G2', techniques: ['T1003.001', 'T1566'] },
    ];
    const rules = [
      rule(1, 'production', ['T1059.001']),
      rule(2, 'testing', ['T1105']),
      rule(3, 'draft', ['T1003.001'], 'high'), // closes a gap of both groups
      rule(4, 'draft', ['T1566']), // closes a gap of G2
      rule(5, 'draft', ['T1059.001']), // already covered: depth only
      rule(6, 'draft', ['T1218']), // unrelated
      rule(7, 'deprecated', ['T1566']),
    ];
    const { techniques, drafts, summary } = prioritize(groups, rules);
    expect(techniques.map((t) => [t.id, t.state, t.groups.length])).toEqual([
      ['T1003.001', 'none', 2],
      ['T1566', 'none', 1],
      ['T1059.001', 'covered', 1],
      ['T1105', 'covered', 1],
    ]);
    expect(techniques[0].draftRules).toBe(1);
    expect(drafts.map((d) => [d.pageId, d.groups.length, d.fills, d.depth])).toEqual([
      [3, 2, ['T1003.001'], []],
      [4, 1, ['T1566'], []],
      [5, 0, [], ['T1059.001']],
    ]);
    expect(summary).toEqual({ techniques: 4, covered: 2, parentOnly: 0, gaps: 2, preCompromise: 0, openWithoutDraft: 0, draftsFillingGaps: 2 });
  });

  it('sorts pre-compromise gaps after the ones rules can close', () => {
    const { techniques, summary } = prioritize([{ id: 'G1', techniques: ['T1583.001', 'T1046'] }], []);
    expect(techniques.map((t) => [t.id, t.preCompromise])).toEqual([
      ['T1046', false],
      ['T1583.001', true],
    ]);
    expect(summary.preCompromise).toBe(1);
    expect(summary.openWithoutDraft).toBe(1);
  });

  it('marks a sub-technique covered only by a parent rule as parent-only', () => {
    const { techniques } = prioritize([{ id: 'G1', techniques: ['T1003.001'] }], [rule(1, 'production', ['T1003'])]);
    expect(techniques[0].state).toBe('parent');
  });
});
