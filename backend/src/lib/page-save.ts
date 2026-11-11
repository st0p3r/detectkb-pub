import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { generateUniqueSlug } from './slug';
import { syncPageLinks } from './links';
import { syncDerivedLinks } from './derived-links';
import { setManualSysmonLinks } from './sysmon-links';
import { ownerField, reviewDateField, sigmaFields, text } from './rule-fields';

// Saving a page with everything that belongs to it — its rule or SPL command
// and its manual Sysmon links — in one transaction, so a failure can't leave
// half of an edit behind. Also here: noticing that someone else saved the
// page in the meantime, keeping a version history, and remembering old slugs.

export class SaveError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

/** Revisions kept per page; older ones are dropped. */
export const MAX_REVISIONS = 100;

/** Rule fields a revision remembers (what the detection is and how to handle it). */
export const REVISION_RULE_FIELDS = [
  'status',
  'severity',
  'splQuery',
  'nativeQuery',
  'nativeLanguage',
  'sigmaYaml',
  'mitreTactics',
  'mitreTechniques',
  'dataSource',
  'falsePositives',
  'references',
  'testNotes',
  'triage',
  'response',
] as const;
export type RevisionRule = Partial<Record<(typeof REVISION_RULE_FIELDS)[number], string | null>>;

export interface Snapshot {
  title: string;
  contentMd: string;
  rule: RevisionRule | null;
}

export function ruleSnapshot(rule: Record<string, unknown> | null | undefined): RevisionRule | null {
  if (!rule) return null;
  const out: RevisionRule = {};
  for (const f of REVISION_RULE_FIELDS) out[f] = (rule[f] as string | null | undefined) ?? null;
  return out;
}

const norm = (v: string | null | undefined) => (v ?? '').replace(/\r\n/g, '\n').trimEnd();

/** What differs between two versions: "title", "content", and rule field names. */
export function changedParts(a: Snapshot, b: Snapshot): string[] {
  const out: string[] = [];
  if (a.title !== b.title) out.push('title');
  if (norm(a.contentMd) !== norm(b.contentMd)) out.push('content');
  if (a.rule || b.rule) for (const f of REVISION_RULE_FIELDS) if (norm(a.rule?.[f]) !== norm(b.rule?.[f])) out.push(f);
  return out;
}

export interface SaveUser {
  userId?: number;
  username: string;
}

export interface PageSaveInput {
  /** The page to update; omitted: a new page */
  id?: number;
  title?: string;
  contentMd?: string;
  type?: string;
  categoryId?: number | null;
  isPinned?: boolean;
  tagNames?: string[];
  /** Rule fields to set (pages of type RULE) */
  rule?: Record<string, unknown>;
  splCommand?: Record<string, unknown>;
  /** Manual Sysmon links (event IDs) */
  sysmonEventIds?: number[];
  /**
   * updatedAt of the page when the editor loaded it. When someone saved since,
   * the save is refused (409) unless `force`.
   */
  expectedUpdatedAt?: string;
  force?: boolean;
}

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));

async function tagIds(tagNames: unknown): Promise<number[]> {
  const names = Array.isArray(tagNames) ? Array.from(new Set(tagNames.map((n) => String(n).trim()).filter(Boolean))) : [];
  const tags = await Promise.all(names.map((name) => prisma.tag.upsert({ where: { name }, create: { name }, update: {} })));
  return tags.map((t) => t.id);
}

/** Rule columns from a request body (only the ones that were sent). */
async function ruleData(body: Record<string, unknown>, pageId: number | null) {
  const sigma = await sigmaFields(body.sigmaYaml, pageId ?? -1);
  if (typeof sigma === 'string') throw new SaveError(400, sigma);
  const owner = await ownerField(body.ownerId);
  if (typeof owner === 'string') throw new SaveError(400, owner);
  const review = reviewDateField(body.nextReviewAt);
  if (typeof review === 'string') throw new SaveError(400, review);
  const opt = (key: string, nullable = true) => (body[key] === undefined ? {} : { [key]: nullable ? text(body[key]) : String(body[key] ?? '') });
  return {
    ...opt('status', false),
    ...opt('severity', false),
    ...opt('splQuery', false),
    ...opt('mitreTactics'),
    ...opt('mitreTechniques'),
    ...opt('dataSource'),
    ...opt('falsePositives'),
    ...opt('references'),
    ...opt('testNotes'),
    ...opt('nativeQuery'),
    ...opt('nativeLanguage'),
    ...opt('triage'),
    ...opt('response'),
    ...owner,
    ...review,
    ...sigma,
  };
}

function splData(body: Record<string, unknown>) {
  const command = str(body.command)?.trim();
  if (!command) throw new SaveError(400, 'command is required');
  return {
    command,
    group: str(body.group) || 'Other',
    syntax: str(body.syntax) ?? '',
    description: str(body.description) ?? '',
    examples: str(body.examples) ?? '',
    pitfalls: str(body.pitfalls) || null,
    isFavorite: Boolean(body.isFavorite),
  };
}

/**
 * Creates or updates a page and what belongs to it. Throws SaveError: 400 for
 * bad input, 404 for an unknown page, 409 (code CONFLICT) when the page was
 * saved by someone else since `expectedUpdatedAt`.
 */
export async function savePage(input: PageSaveInput, user: SaveUser | null) {
  const title = input.title?.trim();
  if (input.title !== undefined && !title) throw new SaveError(400, 'title is required');
  if (!input.id && !title) throw new SaveError(400, 'title is required');
  if (input.sysmonEventIds && !input.sysmonEventIds.every((n) => Number.isInteger(n))) throw new SaveError(400, 'sysmonEventIds must be integers');

  const existing = input.id
    ? await prisma.page.findUnique({ where: { id: input.id }, include: { rule: true, splCommand: true, _count: { select: { revisions: true } } } })
    : null;
  if (input.id && !existing) throw new SaveError(404, 'Page not found');

  if (existing && input.expectedUpdatedAt && !input.force) {
    const expected = new Date(input.expectedUpdatedAt).getTime();
    if (!isNaN(expected) && expected !== existing.updatedAt.getTime()) {
      const last = await prisma.revision.findFirst({ where: { pageId: existing.id }, orderBy: { id: 'desc' }, select: { authorName: true } });
      throw new SaveError(409, 'This page was changed by someone else while you were editing it', {
        code: 'CONFLICT',
        updatedAt: existing.updatedAt,
        updatedBy: last?.authorName ?? null,
      });
    }
  }

  // Checks and lookups that need the database happen before the transaction
  const renamed = !!existing && !!title && title !== existing.title;
  const slug = existing ? (renamed ? await generateUniqueSlug(title!, existing.id) : existing.slug) : await generateUniqueSlug(title!);
  const tags = input.tagNames === undefined ? undefined : await tagIds(input.tagNames);
  const rule = input.rule ? await ruleData(input.rule, existing?.id ?? null) : undefined;
  const spl = input.splCommand ? splData(input.splCommand) : undefined;
  const before: Snapshot | null = existing ? { title: existing.title, contentMd: existing.contentMd, rule: ruleSnapshot(existing.rule) } : null;

  const pageId = await prisma.$transaction(async (tx) => {
    const data = {
      ...(title !== undefined && { title }),
      slug,
      ...(input.contentMd !== undefined && { contentMd: String(input.contentMd) }),
      ...(input.type !== undefined && { type: String(input.type) }),
      ...(input.categoryId !== undefined && { categoryId: Number(input.categoryId) || null }),
      ...(input.isPinned !== undefined && { isPinned: Boolean(input.isPinned) }),
    };
    let id: number;
    if (existing) {
      id = existing.id;
      if (tags) await tx.tagsOnPages.deleteMany({ where: { pageId: id } });
      await tx.page.update({ where: { id }, data: { ...data, ...(tags && { tags: { create: tags.map((tagId) => ({ tagId })) } }) } });
      if (slug !== existing.slug) {
        // The old address keeps working; an alias that now names a real page goes
        await tx.pageSlugAlias.upsert({ where: { slug: existing.slug }, create: { slug: existing.slug, pageId: id }, update: { pageId: id } });
      }
    } else {
      const created = await tx.page.create({
        data: { title: title!, contentMd: '', type: 'NOTE', ...data, ...(tags && { tags: { create: tags.map((tagId) => ({ tagId })) } }) },
        select: { id: true },
      });
      id = created.id;
    }
    await tx.pageSlugAlias.deleteMany({ where: { slug } });

    if (rule) {
      await tx.detectionRule.upsert({
        where: { pageId: id },
        create: { pageId: id, status: 'draft', severity: 'medium', splQuery: '', ...rule },
        update: rule,
      });
    }
    if (spl) await tx.splCommand.upsert({ where: { pageId: id }, create: { pageId: id, ...spl }, update: spl });

    // History: the page as it was before history started, then this version
    const saved = await tx.page.findUniqueOrThrow({ where: { id }, include: { rule: true } });
    const after: Snapshot = { title: saved.title, contentMd: saved.contentMd, rule: ruleSnapshot(saved.rule) };
    const json = (r: RevisionRule | null) => (r ?? undefined) as Prisma.InputJsonValue | undefined;
    if (before && existing!._count.revisions === 0) {
      await tx.revision.create({ data: { pageId: id, title: before.title, contentMd: before.contentMd, rule: json(before.rule), createdAt: existing!.updatedAt } });
    }
    if (!before || changedParts(before, after).length) {
      await tx.revision.create({
        data: { pageId: id, title: after.title, contentMd: after.contentMd, rule: json(after.rule), authorId: user?.userId ?? null, authorName: user?.username ?? null },
      });
      const old = await tx.revision.findMany({ where: { pageId: id }, orderBy: { id: 'desc' }, skip: MAX_REVISIONS, select: { id: true } });
      if (old.length) await tx.revision.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    }
    return id;
  });

  // Derived from what was just saved, and rebuilt at every start: outside the transaction
  if (input.sysmonEventIds) await setManualSysmonLinks(pageId, input.sysmonEventIds);
  const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { contentMd: true } });
  await syncPageLinks(pageId, page.contentMd);
  await syncDerivedLinks(pageId);
  if (tags) await prisma.tag.deleteMany({ where: { pages: { none: {} } } });
  return pageId;
}

export interface RevisionSummary {
  id: number;
  title: string;
  createdAt: Date;
  author: string | null;
  /** What this version changed compared with the one before it (empty for the first) */
  changed: string[];
  current: boolean;
}

const toSnapshot = (r: { title: string; contentMd: string; rule: unknown }): Snapshot => ({
  title: r.title,
  contentMd: r.contentMd,
  rule: (r.rule as RevisionRule | null) ?? null,
});

/** A page's versions, newest first. */
export async function listRevisions(pageId: number): Promise<RevisionSummary[]> {
  const revs = await prisma.revision.findMany({ where: { pageId }, orderBy: { id: 'asc' } });
  return revs
    .map((r, i) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      author: r.authorName,
      changed: i ? changedParts(toSnapshot(revs[i - 1]), toSnapshot(r)) : [],
      current: i === revs.length - 1,
    }))
    .reverse();
}

/** One version and the one before it (to show what it changed). */
export async function getRevision(pageId: number, revisionId: number) {
  const rev = await prisma.revision.findFirst({ where: { id: revisionId, pageId } });
  if (!rev) return null;
  const previous = await prisma.revision.findFirst({ where: { pageId, id: { lt: rev.id } }, orderBy: { id: 'desc' } });
  return {
    id: rev.id,
    createdAt: rev.createdAt,
    author: rev.authorName,
    ...toSnapshot(rev),
    previous: previous ? { id: previous.id, ...toSnapshot(previous) } : null,
  };
}

/** Makes an earlier version the page again (as a new version: nothing is lost). */
export async function restoreRevision(pageId: number, revisionId: number, user: SaveUser | null) {
  const rev = await prisma.revision.findFirst({ where: { id: revisionId, pageId } });
  if (!rev) throw new SaveError(404, 'Version not found');
  const rule = rev.rule as RevisionRule | null;
  const hasRule = !!(await prisma.detectionRule.findUnique({ where: { pageId }, select: { id: true } }));
  return savePage({ id: pageId, title: rev.title, contentMd: rev.contentMd, ...(rule && hasRule && { rule: rule as Record<string, unknown> }), force: true }, user);
}
