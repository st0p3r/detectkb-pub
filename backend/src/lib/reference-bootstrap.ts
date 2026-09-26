import { prisma } from './prisma';
import { REFERENCE_KINDS, ReferenceKind, fetchReferenceData } from './references';

/**
 * Downloads reference datasets that were never loaded. Runs in the background
 * at startup; failures (e.g. an offline server) are only logged — admins can
 * retry or upload the files from the Attacker Tools page.
 * Disable with REFERENCE_AUTO_FETCH=false.
 */
export function fetchMissingReferenceData(): void {
  if (process.env.REFERENCE_AUTO_FETCH === 'false') return;
  (async () => {
    const loaded = new Set((await prisma.referenceDataset.findMany({ select: { kind: true } })).map((d) => d.kind));
    for (const kind of Object.keys(REFERENCE_KINDS) as ReferenceKind[]) {
      if (loaded.has(kind)) continue;
      try {
        const count = await fetchReferenceData(kind);
        console.log(`[references] Loaded ${count} ${REFERENCE_KINDS[kind].label} entries`);
      } catch (err) {
        console.warn(`[references] Could not download ${REFERENCE_KINDS[kind].label}: ${(err as Error).message}`);
      }
    }
  })().catch((err) => console.warn('[references] bootstrap failed:', err));
}
