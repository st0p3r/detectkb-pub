import { prisma } from './prisma';
import { ATTACK_VERSION, REVOKED_TECHNIQUES, TECHNIQUES, setAttackData } from './attack';
import { GROUPS, SOFTWARE, setCtiData } from './attack-cti';
import { AttackDataset, convertStixBundle } from './attack-stix';
import { syncAllRuleTechniques } from './rule-techniques';
import attackData from '../data/attack-enterprise.json';
import ctiData from '../data/attack-cti.json';

// Updating ATT&CK without a new DetectKB release: MITRE's STIX bundle is
// downloaded or uploaded (offline servers), converted, stored in the database
// and swapped in. At startup the stored copy is used when it is newer than
// the one bundled with the application.

export const ATTACK_STIX_URL =
  process.env.ATTACK_STIX_URL || 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';

export const BUNDLED_ATTACK_VERSION: string | null = attackData.version;

/** Compares ATT&CK versions ("19.2" < "20.0"); null sorts first. */
export function compareVersions(a: string | null, b: string | null): number {
  const parts = (v: string | null) => (v ?? '0').split('.').map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function apply(data: AttackDataset) {
  setAttackData(data);
  setCtiData(data);
}

/** At startup: use the imported data when it is newer than (or as new as) the bundled copy. */
export async function loadStoredAttackData() {
  const row = await prisma.attackData.findUnique({ where: { id: 1 } });
  if (!row) return;
  if (compareVersions(row.version, BUNDLED_ATTACK_VERSION) < 0) {
    console.log(`[attack] bundled ATT&CK v${BUNDLED_ATTACK_VERSION} is newer than the imported v${row.version}; using the bundled one`);
    return;
  }
  try {
    apply(JSON.parse(row.data) as AttackDataset);
    console.log(`[attack] using imported ATT&CK v${row.version}`);
  } catch (err) {
    console.error('[attack] imported ATT&CK data is unreadable, using the bundled copy:', err);
  }
}

export interface AttackImportResult {
  from: string | null;
  to: string | null;
  techniques: { added: string[]; removed: string[] };
  /** IDs newly revoked: rules using them now count under the replacement */
  newlyRevoked: Record<string, string>;
  groups: { added: number; removed: number };
  software: { added: number; removed: number };
  /** Rule technique rows that changed (resolution of the rules' IDs) */
  ruleMappings: { added: number; removed: number };
}

/**
 * Converts a STIX bundle and makes it the ATT&CK data in use. Refuses an older
 * release than the one in use unless `allowOlder`.
 */
export async function importAttackBundle(bundle: unknown, source: string, userId: number | null, allowOlder = false): Promise<AttackImportResult> {
  const data = convertStixBundle(bundle);
  if (!allowOlder && compareVersions(data.version, ATTACK_VERSION) < 0) {
    throw Object.assign(new Error(`This is ATT&CK v${data.version}, older than v${ATTACK_VERSION} in use`), { status: 400, expose: true });
  }
  const before = {
    version: ATTACK_VERSION,
    techniques: new Set(TECHNIQUES.map((t) => t.id)),
    revoked: { ...REVOKED_TECHNIQUES },
    groups: new Set(GROUPS.map((g) => g.id)),
    software: new Set(SOFTWARE.map((s) => s.id)),
  };
  await prisma.attackData.upsert({
    where: { id: 1 },
    create: { id: 1, version: data.version, source: source.slice(0, 500), data: JSON.stringify(data), importedById: userId },
    update: { version: data.version, source: source.slice(0, 500), data: JSON.stringify(data), importedById: userId, importedAt: new Date() },
  });
  apply(data);
  const ruleMappings = await syncAllRuleTechniques();
  const now = new Set(data.techniques.map((t) => t.id));
  const diff = (a: Set<string>, b: Set<string>) => Array.from(a).filter((x) => !b.has(x)).sort();
  return {
    from: before.version,
    to: data.version,
    techniques: { added: diff(now, before.techniques), removed: diff(before.techniques, now) },
    newlyRevoked: Object.fromEntries(Object.entries(data.revoked).filter(([k]) => !before.revoked[k])),
    groups: { added: diff(new Set(data.groups.map((g) => g.id)), before.groups).length, removed: diff(before.groups, new Set(data.groups.map((g) => g.id))).length },
    software: {
      added: diff(new Set(data.software.map((s) => s.id)), before.software).length,
      removed: diff(before.software, new Set(data.software.map((s) => s.id))).length,
    },
    ruleMappings,
  };
}

/** Downloads MITRE's current Enterprise bundle and imports it. */
export async function downloadAttackBundle(userId: number | null) {
  const res = await fetch(ATTACK_STIX_URL, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw Object.assign(new Error(`Download failed: HTTP ${res.status}`), { status: 502, expose: true });
  return importAttackBundle(await res.json(), ATTACK_STIX_URL, userId);
}

/** Goes back to the copy bundled with the application. */
export async function resetAttackData() {
  await prisma.attackData.deleteMany({});
  setAttackData(attackData);
  setCtiData(ctiData as Parameters<typeof setCtiData>[0]);
  return syncAllRuleTechniques();
}

/** What is in use, for the settings card. */
export async function attackDataInfo() {
  const row = await prisma.attackData.findUnique({ where: { id: 1 }, select: { version: true, source: true, importedAt: true } });
  const imported = row && row.version === ATTACK_VERSION ? row : null;
  return {
    version: ATTACK_VERSION,
    bundledVersion: BUNDLED_ATTACK_VERSION,
    imported: imported ? { source: imported.source, importedAt: imported.importedAt } : null,
    techniques: TECHNIQUES.length,
    groups: GROUPS.length,
    software: SOFTWARE.length,
    downloadUrl: ATTACK_STIX_URL,
  };
}
