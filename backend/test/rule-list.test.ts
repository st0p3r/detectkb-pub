import { describe, expect, it } from 'vitest';
import { enumSlices, parseRuleListQuery, ruleWhere, MAX_PAGE_SIZE } from '../src/lib/rule-list';

const ORDER = ['draft', 'testing', 'production', 'deprecated'];

/** Reference: the full list in order, sliced — what enumSlices must reproduce. */
function expected(counts: Map<string, number>, skip: number, take: number) {
  const known = ORDER.flatMap((v) => Array.from({ length: counts.get(v) ?? 0 }, (_, i) => `${v}#${i}`));
  const other = Array.from(counts).filter(([v]) => !ORDER.includes(v)).flatMap(([v, c]) => Array.from({ length: c }, () => 'other'));
  return [...known, ...other].slice(skip, skip + take);
}

function run(counts: Map<string, number>, skip: number, take: number) {
  return enumSlices(ORDER, counts, skip, take).flatMap((s) =>
    Array.from({ length: s.take }, (_, i) => (typeof s.value === 'string' ? `${s.value}#${s.skip + i}` : 'other'))
  );
}

describe('rule list: enum sort slices', () => {
  const counts = new Map([
    ['production', 7],
    ['draft', 3],
    ['weird', 2],
    ['deprecated', 1],
  ]);

  it('reproduces every page of the ordered list', () => {
    for (const take of [1, 2, 3, 5, 50]) {
      for (let skip = 0; skip < 16; skip += take) expect(run(counts, skip, take)).toEqual(expected(counts, skip, take));
    }
  });

  it('puts unknown values last and skips empty buckets', () => {
    const slices = enumSlices(ORDER, counts, 10, 10);
    expect(slices).toEqual([
      { value: 'deprecated', skip: 0, take: 1 },
      { value: { notIn: ORDER }, skip: 0, take: 2 },
    ]);
    expect(enumSlices(ORDER, counts, 100, 10)).toEqual([]);
  });
});

describe('rule list: query parsing', () => {
  it('clamps paging and defaults the sort', () => {
    expect(parseRuleListQuery({})).toMatchObject({ page: 1, pageSize: 50, sort: 'updatedAt', dir: 'desc' });
    expect(parseRuleListQuery({ page: '-3', pageSize: '100000', sort: 'title' })).toMatchObject({
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      sort: 'title',
      dir: 'asc',
    });
    expect(parseRuleListQuery({ sort: 'splQuery; DROP', dir: 'sideways' }).sort).toBe('updatedAt');
  });

  it('maps "manual" to rules without an import source, and leaves status out of chip counts', () => {
    const f = parseRuleListQuery({ source: 'manual', status: 'draft', q: ' mimikatz ' });
    expect(ruleWhere(f)).toEqual({
      AND: [
        { status: { in: ['draft'] } },
        { sourceFormat: null },
        {
          OR: [
            { page: { title: { contains: 'mimikatz' } } },
            { mitreTechniques: { contains: 'mimikatz' } },
            { dataSource: { contains: 'mimikatz' } },
            { sigmaId: { contains: 'mimikatz' } },
            { sourceId: { contains: 'mimikatz' } },
          ],
        },
      ],
    });
    expect(JSON.stringify(ruleWhere(f, 'status'))).not.toContain('draft');
    expect(ruleWhere(parseRuleListQuery({}))).toEqual({});
  });
});
