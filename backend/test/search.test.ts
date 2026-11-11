import { describe, expect, it } from 'vitest';
import { rank, scoreResult, searchTerms, snippetAround } from '../src/lib/search';

describe('search ranking', () => {
  it('splits a query into words', () => {
    expect(searchTerms('  LSASS   dump lsass ')).toEqual(['lsass', 'dump']);
    expect(searchTerms('a b c d e f g h')).toHaveLength(6);
  });

  it('needs every word, in the title or a field', () => {
    const fields = [{ label: 'SPL query', text: 'index=win EventCode=10 TargetImage=*lsass.exe', weight: 4 }];
    expect(scoreResult('Credential dumping', fields, ['lsass', 'dumping'])).not.toBeNull();
    expect(scoreResult('Credential dumping', fields, ['lsass', 'kerberos'])).toBeNull();
    expect(scoreResult('Anything', fields, [])).toBeNull();
  });

  it('ranks title matches above text matches', () => {
    const text = [{ label: 'Text', text: 'mentions lsass somewhere', weight: 2 }];
    const exact = scoreResult('LSASS', [], ['lsass'])!;
    const prefix = scoreResult('LSASS memory access', [], ['lsass'])!;
    const inside = scoreResult('Access to LSASS memory', [], ['lsass'])!;
    const body = scoreResult('Credential access', text, ['lsass'])!;
    expect(exact.score).toBeGreaterThan(prefix.score);
    expect(prefix.score).toBeGreaterThan(inside.score);
    expect(inside.score).toBeGreaterThan(body.score);
  });

  it('says where it matched and quotes that place', () => {
    const fields = [
      { label: 'Text', text: 'A long description that also says kerberoasting once.', weight: 2 },
      { label: 'ATT&CK technique', text: 'T1558.003, Kerberoasting', weight: 8 },
    ];
    expect(scoreResult('Service ticket request', fields, ['kerberoasting'])).toMatchObject({ matchedIn: 'ATT&CK technique', snippet: 'T1558.003, Kerberoasting' });
    // Only the title matches: the fallback text is quoted
    expect(scoreResult('Kerberoasting', [], ['kerberoasting'], 'Detects ticket requests.')).toMatchObject({ matchedIn: 'Title', snippet: 'Detects ticket requests.' });
  });

  it('does not take a number for part of a technique ID', () => {
    const technique = { label: 'ATT&CK technique', text: 'T1003.001, LSASS Memory', weight: 8, skipNumbers: true };
    const telemetry = { label: 'Telemetry', text: 'Sysmon 10 Process Access', weight: 5 };
    expect(scoreResult('Some rule', [technique], ['10'])).toBeNull();
    expect(scoreResult('Some rule', [technique, telemetry], ['sysmon', '10'])).toMatchObject({ matchedIn: 'Telemetry' });
    expect(scoreResult('Some rule', [technique], ['t1003.001'])).toMatchObject({ matchedIn: 'ATT&CK technique' });
  });

  it('cuts a snippet around the match', () => {
    const text = `${'x'.repeat(300)} needle ${'y'.repeat(300)}`;
    const s = snippetAround(text, ['needle']);
    expect(s.startsWith('…') && s.endsWith('…')).toBe(true);
    expect(s).toContain('needle');
    expect(s.length).toBeLessThan(210);
  });

  it('drops Markdown marks from a snippet but keeps underscores inside words', () => {
    expect(snippetAround('## Setup\n**Author:** me `x` _Imported from Sigma._ process_creation', ['author'])).toBe('Setup Author: me x Imported from Sigma. process_creation');
  });

  it('orders by score, then by the latest change', () => {
    const a = { score: 5, updatedAt: new Date('2026-01-01') };
    const b = { score: 9, updatedAt: new Date('2025-01-01') };
    const c = { score: 5, updatedAt: new Date('2026-06-01') };
    expect(rank([a, b, c])).toEqual([b, c, a]);
  });
});
