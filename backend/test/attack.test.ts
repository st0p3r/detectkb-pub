import { describe, expect, it } from 'vitest';
import {
  ATTACK_VERSION,
  REVOKED_TECHNIQUES,
  TACTICS,
  TECHNIQUES,
  TECHNIQUE_BY_ID,
  findTactic,
  parseTechniqueIds,
  replaceRetiredTechniques,
  resolveTechniqueId,
} from '../src/lib/attack';

describe('bundled ATT&CK dataset', () => {
  it('is a complete Enterprise matrix', () => {
    expect(ATTACK_VERSION).toMatch(/^\d+\.\d+$/);
    expect(TACTICS.length).toBeGreaterThanOrEqual(14);
    expect(TECHNIQUES.filter((t) => !t.id.includes('.')).length).toBeGreaterThan(150);
  });

  it('gives every technique at least one known tactic', () => {
    const shortnames = new Set(TACTICS.map((t) => t.shortname));
    for (const t of TECHNIQUES) {
      expect(t.tactics.length, t.id).toBeGreaterThan(0);
      for (const s of t.tactics) expect(shortnames.has(s), `${t.id} → ${s}`).toBe(true);
    }
  });

  it('has a parent for every sub-technique', () => {
    for (const t of TECHNIQUES.filter((x) => x.id.includes('.'))) {
      expect(TECHNIQUE_BY_ID.has(t.id.split('.')[0]), t.id).toBe(true);
    }
  });

  it('maps revoked IDs only onto current techniques', () => {
    for (const [from, to] of Object.entries(REVOKED_TECHNIQUES)) {
      expect(TECHNIQUE_BY_ID.has(from), `${from} should be retired`).toBe(false);
      expect(TECHNIQUE_BY_ID.has(to), `${from} → ${to}`).toBe(true);
    }
  });
});

describe('technique helpers', () => {
  it('parses IDs from free text', () => {
    expect(parseTechniqueIds('T1110, t1110.001; attack.t1059.001 T12345')).toEqual(['T1110', 'T1110.001', 'T1059.001']);
  });

  it('resolves current, revoked and unknown IDs', () => {
    expect(resolveTechniqueId('T1003.001')).toBe('T1003.001');
    expect(resolveTechniqueId('T1562.001')).toBe(REVOKED_TECHNIQUES['T1562.001']);
    expect(resolveTechniqueId('T9999')).toBeNull();
  });

  it('finds tactics by id, shortname, Sigma tag form and legacy name', () => {
    expect(findTactic('TA0006')?.shortname).toBe('credential-access');
    expect(findTactic('credential_access')?.id).toBe('TA0006');
    expect(findTactic('Credential Access')?.id).toBe('TA0006');
    expect(findTactic('defense-evasion')?.id).toBe('TA0005');
    expect(findTactic('defense_evasion')?.id).toBe('TA0005');
  });
});

describe('replaceRetiredTechniques', () => {
  it('swaps retired IDs for their replacements and drops duplicates', () => {
    expect(replaceRetiredTechniques('T1562, T1562.004, T1059')).toEqual({
      text: 'T1685, T1686, T1059',
      replaced: [
        ['T1562', 'T1685'],
        ['T1562.004', 'T1686'],
      ],
    });
    expect(replaceRetiredTechniques('T1685, T1562').text).toBe('T1685');
  });

  it('leaves current IDs, empty values and free text without retired IDs as they are', () => {
    expect(replaceRetiredTechniques('T1059,T1003.001')).toEqual({ text: 'T1059,T1003.001', replaced: [] });
    expect(replaceRetiredTechniques(null)).toEqual({ text: null, replaced: [] });
    expect(replaceRetiredTechniques('see T1059 notes')).toEqual({ text: 'see T1059 notes', replaced: [] });
  });

  it('replaces inside free text without reformatting it', () => {
    expect(replaceRetiredTechniques('Defense impairment (t1070.001)').text).toBe('Defense impairment (T1685.005)');
  });
});
