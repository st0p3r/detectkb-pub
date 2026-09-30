import { prisma } from './prisma';
import { parseSigmaDocuments } from './sigma';

// Sigma logsource categories (product: windows) → Sysmon event IDs that feed them.
// Mirrors the official table in the Sigma specification (pinned by test/sysmon-links.test.ts):
// https://github.com/SigmaHQ/sigma-specification/blob/main/specification/sigma-appendix-taxonomy.md
export const SIGMA_CATEGORY_TO_SYSMON: Record<string, number[]> = {
  process_creation: [1],
  file_change: [2],
  network_connection: [3],
  sysmon_status: [4, 16],
  process_termination: [5],
  driver_load: [6],
  image_load: [7],
  create_remote_thread: [8],
  raw_access_thread: [9],
  process_access: [10],
  file_event: [11],
  registry_event: [12, 13, 14],
  registry_add: [12],
  registry_delete: [12],
  registry_set: [13],
  registry_rename: [14],
  create_stream_hash: [15],
  pipe_created: [17, 18],
  wmi_event: [19, 20, 21],
  dns_query: [22],
  file_delete: [23],
  clipboard_capture: [24],
  process_tampering: [25],
  file_delete_detected: [26],
  file_block_executable: [27],
  file_block_shredding: [28],
  file_executable_detected: [29],
  sysmon_error: [255],
};

const EVENT_ID_PATTERNS = [
  // SPL EventCode=10, KQL EventID == 10, EQL/ECS event.code == "10", Sigma EventID: 10
  /\b(?:EventCode|EventID|event\.code|winlog\.event_id)\s*(?:==|=~|=|:)\s*["']?(\d{1,3})\b/gi,
  // Lists: SPL EventCode IN (1, 3), KQL EventID in (1, 3), EQL event.code in ("1", "3")
  /\b(?:EventCode|EventID|event\.code|winlog\.event_id)\s+in~?\s*\(([^)]*)\)/gi,
  // Prose / ESCU data_source: "Event ID 10", "Sysmon EventID 10", "EventCode 10"
  /\bEvent\s?(?:ID|Code)\s*:?\s*(\d{1,3})\b/gi,
];

/** Event IDs mentioned in SPL / prose, only trusted when the text is about Sysmon. */
export function eventIdsFromText(text: string): number[] {
  if (!/sysmon/i.test(text)) return [];
  const ids = new Set<number>();
  for (const pattern of EVENT_ID_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      for (const n of match[1].match(/\b\d{1,3}\b/g) ?? []) ids.add(Number(n));
    }
  }
  return Array.from(ids);
}

/** Event IDs implied by a Sigma rule's logsource (and explicit EventID filters for service: sysmon). */
export function eventIdsFromSigma(sigmaYaml: string): number[] {
  const ids = new Set<number>();
  for (const { doc } of parseSigmaDocuments(sigmaYaml)) {
    if (!doc) continue;
    const logsource = (doc.logsource ?? {}) as Record<string, unknown>;
    const category = String(logsource.category ?? '').toLowerCase();
    const product = String(logsource.product ?? '').toLowerCase();
    const service = String(logsource.service ?? '').toLowerCase();
    if (product === 'windows' && SIGMA_CATEGORY_TO_SYSMON[category]) {
      SIGMA_CATEGORY_TO_SYSMON[category].forEach((id) => ids.add(id));
    }
    if (service === 'sysmon') {
      const detection = JSON.stringify(doc.detection ?? {});
      for (const m of detection.matchAll(/"EventID":\s*(\[[^\]]*\]|\d+)/g)) {
        for (const n of m[1].match(/\d+/g) ?? []) ids.add(Number(n));
      }
    }
  }
  return Array.from(ids);
}

export type SysmonBasis = 'declared' | 'inferred';

/** Sysmon event IDs a Sigma rule names explicitly (service: sysmon with EventID filters). */
function sigmaServiceIds(sigmaYaml: string): number[] {
  const ids = new Set<number>();
  for (const { doc } of parseSigmaDocuments(sigmaYaml)) {
    const logsource = (doc?.logsource ?? {}) as Record<string, unknown>;
    if (String(logsource.service ?? '').toLowerCase() !== 'sysmon') continue;
    for (const m of JSON.stringify(doc?.detection ?? {}).matchAll(/"EventID":\s*(\[[^\]]*\]|\d+)/g)) {
      for (const n of m[1].match(/\d+/g) ?? []) ids.add(Number(n));
    }
  }
  return Array.from(ids);
}

/**
 * The Sysmon events a rule / data source page depends on, and why: declared
 * when its data source field (or Sigma service: sysmon) names them, inferred
 * when found in the query or implied by a Sigma category.
 */
export function inferSysmonLinks(page: {
  title: string;
  type: string;
  contentMd: string;
  rule: { splQuery: string; dataSource: string | null; sigmaYaml: string | null; nativeQuery: string | null } | null;
}): Map<number, SysmonBasis> {
  const out = new Map<number, SysmonBasis>();
  const add = (ids: number[], basis: SysmonBasis) => {
    for (const id of ids) if (out.get(id) !== 'declared') out.set(id, basis);
  };
  if (page.rule) {
    const { splQuery, dataSource, sigmaYaml, nativeQuery } = page.rule;
    add(eventIdsFromText(`${dataSource ?? ''}\n${splQuery}\n${nativeQuery ?? ''}`), 'inferred');
    add(eventIdsFromText(dataSource ?? ''), 'declared');
    if (sigmaYaml) {
      add(eventIdsFromSigma(sigmaYaml), 'inferred');
      add(sigmaServiceIds(sigmaYaml), 'declared');
    }
  } else if (page.type === 'DATA_SOURCE') {
    add(eventIdsFromText(`${page.title}\n${page.contentMd}`), 'declared');
  }
  return out;
}

async function inferEventIds(pageId: number): Promise<Map<number, SysmonBasis>> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, include: { rule: true } });
  return page ? inferSysmonLinks(page) : new Map();
}

/** Recomputes the automatically inferred Sysmon links of a page; manual links are kept. */
export async function syncAutoSysmonLinks(pageId: number): Promise<void> {
  const inferred = await inferEventIds(pageId);
  const events = inferred.size
    ? await prisma.sysmonEvent.findMany({ where: { eventId: { in: Array.from(inferred.keys()) } }, select: { id: true, eventId: true } })
    : [];
  const desired = new Map(events.map((e) => [e.id, inferred.get(e.eventId)!]));

  const existing = await prisma.pageSysmonEvent.findMany({ where: { pageId } });
  const stale = existing.filter((l) => l.source === 'auto' && !desired.has(l.sysmonEventId));
  const linked = new Set(existing.map((l) => l.sysmonEventId));
  const missing = Array.from(desired.keys()).filter((id) => !linked.has(id));
  const rebased = existing.filter((l) => l.source === 'auto' && desired.has(l.sysmonEventId) && desired.get(l.sysmonEventId) !== l.basis);
  for (const l of rebased) {
    await prisma.pageSysmonEvent.update({
      where: { pageId_sysmonEventId: { pageId, sysmonEventId: l.sysmonEventId } },
      data: { basis: desired.get(l.sysmonEventId)! },
    });
  }

  if (stale.length) {
    await prisma.pageSysmonEvent.deleteMany({
      where: { pageId, source: 'auto', sysmonEventId: { in: stale.map((l) => l.sysmonEventId) } },
    });
  }
  if (missing.length) {
    await prisma.pageSysmonEvent.createMany({
      data: missing.map((sysmonEventId) => ({ pageId, sysmonEventId, source: 'auto', basis: desired.get(sysmonEventId)! })),
      skipDuplicates: true,
    });
  }
}

/** Replaces a page's manual links (Sysmon event numbers, e.g. [1, 10]). */
export async function setManualSysmonLinks(pageId: number, eventIds: number[]): Promise<void> {
  const events = eventIds.length
    ? await prisma.sysmonEvent.findMany({ where: { eventId: { in: eventIds } }, select: { id: true } })
    : [];
  const keep = events.map((e) => e.id);

  await prisma.$transaction([
    prisma.pageSysmonEvent.deleteMany({ where: { pageId, source: 'manual', sysmonEventId: { notIn: keep } } }),
    ...keep.map((sysmonEventId) =>
      prisma.pageSysmonEvent.upsert({
        where: { pageId_sysmonEventId: { pageId, sysmonEventId } },
        create: { pageId, sysmonEventId, source: 'manual', basis: 'manual' },
        update: { source: 'manual', basis: 'manual' },
      })
    ),
  ]);
  // A removed manual link may still be implied by the rule itself
  await syncAutoSysmonLinks(pageId);
}

/** Backfills auto links for every rule and data-source page (run at startup / after restore). */
export async function syncAllSysmonLinks(): Promise<void> {
  const pages = await prisma.page.findMany({
    where: { OR: [{ rule: { isNot: null } }, { type: 'DATA_SOURCE' }] },
    select: { id: true },
  });
  for (const { id } of pages) await syncAutoSysmonLinks(id);
}
