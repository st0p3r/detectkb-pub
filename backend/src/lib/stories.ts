import { Prisma } from '@prisma/client';
import { parse as parseYaml } from 'yaml';
import { prisma } from './prisma';
import { markDataChanged } from './kb-cache';

// Splunk analytic stories. ESCU detections name theirs in tags.analytic_story;
// the story files (stories/*.yml in splunk/security_content) add the
// description, narrative and references.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());

/** Story names an ESCU detection belongs to (analytic_story; tags.analytic_story in older files). */
export function ruleStoryNames(sourceFormat: string | null, sourceContent: string | null): string[] {
  if (sourceFormat !== 'escu' || !sourceContent) return [];
  try {
    const doc = parseYaml(sourceContent) as unknown;
    if (!isObj(doc)) return [];
    const list = doc.analytic_story ?? (isObj(doc.tags) ? doc.tags.analytic_story : undefined);
    const names = (Array.isArray(list) ? list : list ? [list] : []).map(str).filter(Boolean);
    return Array.from(new Set(names.map((n) => n.slice(0, 191))));
  } catch {
    return [];
  }
}

export interface StoryDetails {
  name: string;
  externalId: string | null;
  description: string | null;
  narrative: string | null;
  references: string[];
  category: string | null;
  usecase: string | null;
}

/** A story file (YAML) → its details, or null when it isn't one. */
export function parseStoryYaml(content: string): StoryDetails | null {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch {
    return null;
  }
  // Detections also have name/description; a story has a narrative and no search
  if (!isObj(doc) || !str(doc.name) || !('narrative' in doc) || 'search' in doc) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : []);
  return {
    name: str(doc.name).slice(0, 191),
    externalId: str(doc.id).slice(0, 64) || null,
    description: str(doc.description) || null,
    narrative: str(doc.narrative) || null,
    references: list(doc.references),
    category: list(doc.category).join(', ').slice(0, 191) || null,
    usecase: str(doc.usecase).slice(0, 120) || null,
  };
}

/** Saves story details (creating the story if no rule named it yet). */
export async function saveStoryDetails(details: StoryDetails, from: string): Promise<void> {
  const data = {
    externalId: details.externalId,
    description: details.description,
    narrative: details.narrative,
    references: details.references as Prisma.InputJsonValue,
    category: details.category,
    usecase: details.usecase,
    detailsFrom: from.slice(0, 500),
  };
  await prisma.analyticStory.upsert({ where: { name: details.name }, create: { name: details.name, ...data }, update: data });
}

/** Imports story files; returns how many were stories. */
export async function importStoryFiles(files: { name: string; content: string }[]): Promise<{ imported: number; skipped: string[] }> {
  let imported = 0;
  const skipped: string[] = [];
  for (const f of files) {
    const details = parseStoryYaml(f.content);
    if (!details) {
      skipped.push(f.name);
      continue;
    }
    await saveStoryDetails(details, `file: ${f.name}`);
    imported++;
  }
  if (imported) markDataChanged();
  return { imported, skipped };
}

export const STORY_REPO_RAW = 'https://raw.githubusercontent.com/splunk/security_content/develop/stories';
/** The file name security_content uses for a story ("Masquerading - Rename" → masquerading___rename.yml) */
export const storyFileName = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9$]/g, '_')}.yml`;

/**
 * Downloads the story files of stories that have no details yet from the
 * security_content repository (or of every story with `all`).
 */
export async function fetchStoryDetails(opts: { all?: boolean } = {}): Promise<{ fetched: number; missing: string[] }> {
  const stories = await prisma.analyticStory.findMany({ where: opts.all ? {} : { description: null }, select: { name: true } });
  let fetched = 0;
  const missing: string[] = [];
  const queue = [...stories];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const url = `${STORY_REPO_RAW}/${encodeURIComponent(storyFileName(s.name))}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(String(res.status));
        const details = parseStoryYaml(await res.text());
        if (!details) throw new Error('not a story');
        // Keep the name rules use, even if the file spells it differently
        await saveStoryDetails({ ...details, name: s.name }, url);
        fetched++;
      } catch {
        missing.push(s.name);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (fetched) markDataChanged();
  return { fetched, missing };
}

// ── Rule ↔ story links ──────────────────────────────────────────────────────

async function storyIds(names: string[]): Promise<Map<string, number>> {
  if (!names.length) return new Map();
  await prisma.analyticStory.createMany({ data: names.map((name) => ({ name })), skipDuplicates: true });
  const rows = await prisma.analyticStory.findMany({ where: { name: { in: names } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.name, r.id]));
}

async function sync(rules: { pageId: number; sourceFormat: string | null; sourceContent: string | null }[]) {
  const namesByPage = new Map(rules.map((r) => [r.pageId, ruleStoryNames(r.sourceFormat, r.sourceContent)]));
  const ids = await storyIds(Array.from(new Set(Array.from(namesByPage.values()).flat())));
  const pageIds = rules.map((r) => r.pageId);
  const existing = await prisma.ruleStory.findMany({ where: { pageId: { in: pageIds } } });
  const have = new Set(existing.map((l) => `${l.pageId}|${l.storyId}`));
  const want = new Set<string>();
  for (const [pageId, names] of namesByPage) for (const n of names) want.add(`${pageId}|${ids.get(n)}`);
  const stale = existing.filter((l) => !want.has(`${l.pageId}|${l.storyId}`));
  const added = Array.from(want)
    .filter((k) => !have.has(k))
    .map((k) => {
      const [pageId, storyId] = k.split('|').map(Number);
      return { pageId, storyId };
    });
  for (let i = 0; i < stale.length; i += 500) {
    await prisma.ruleStory.deleteMany({ where: { OR: stale.slice(i, i + 500).map(({ pageId, storyId }) => ({ pageId, storyId })) } });
  }
  for (let i = 0; i < added.length; i += 1000) await prisma.ruleStory.createMany({ data: added.slice(i, i + 1000), skipDuplicates: true });
  // Stories that lost their last rule and never got details were only names
  await prisma.analyticStory.deleteMany({ where: { rules: { none: {} }, description: null } });
  return { added: added.length, removed: stale.length };
}

/** Recomputes a rule's stories (after it is saved or imported). */
export async function syncRuleStories(pageId: number): Promise<void> {
  const rule = await prisma.detectionRule.findUnique({ where: { pageId }, select: { pageId: true, sourceFormat: true, sourceContent: true } });
  if (rule) await sync([rule]);
  else await prisma.ruleStory.deleteMany({ where: { pageId } });
}

/** Recomputes every rule's stories (startup, restore). */
export async function syncAllRuleStories() {
  const rules = await prisma.detectionRule.findMany({ select: { pageId: true, sourceFormat: true, sourceContent: true } });
  return sync(rules);
}
