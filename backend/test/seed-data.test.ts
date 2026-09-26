import { describe, expect, it } from 'vitest';
import { SYSMON_EVENTS } from '../src/lib/seed';
import { TECHNIQUE_BY_ID, parseTechniqueIds } from '../src/lib/attack';

// The built-in Sysmon reference must only cite techniques that exist in the
// bundled ATT&CK release (catches IDs MITRE has revoked, like T1562.001).
describe('built-in Sysmon events', () => {
  it('covers Sysmon event IDs 1-29 exactly once', () => {
    expect(SYSMON_EVENTS.map((e) => e.eventId)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  it.each(SYSMON_EVENTS.map((e) => [e.eventId, e]))('event %i cites only current ATT&CK techniques', (_id, e) => {
    const ids = parseTechniqueIds(e.attackPatterns);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(TECHNIQUE_BY_ID.has(id), `${id} is not in ATT&CK`).toBe(true);
  });

  it.each(SYSMON_EVENTS.map((e) => [e.eventId, e]))('event %i has no duplicate key fields', (_id, e) => {
    const fields = e.keyFields.split(',').map((f) => f.trim());
    expect(new Set(fields).size).toBe(fields.length);
  });
});
