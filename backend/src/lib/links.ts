import { prisma } from './prisma';

/** Titles of the [[wiki links]] in markdown, trimmed and de-duplicated. */
export function wikiLinkTitles(contentMd: string): string[] {
  const titles = new Set<string>();
  for (const m of contentMd.matchAll(/\[\[([^\]]+)\]\]/g)) titles.add(m[1].trim());
  return Array.from(titles);
}

/**
 * Where each [[wiki link]] in the markdown points: lower-cased title → slug.
 * Links to missing pages are left out (shown as broken).
 */
export async function resolveWikiLinks(contentMd: string): Promise<Record<string, string>> {
  const titles = wikiLinkTitles(contentMd);
  if (!titles.length) return {};
  // MySQL's default collation matches titles case-insensitively
  const pages = await prisma.page.findMany({ where: { title: { in: titles } }, select: { title: true, slug: true } });
  return Object.fromEntries(pages.map((p) => [p.title.toLowerCase(), p.slug]));
}

export async function syncPageLinks(sourceId: number, contentMd: string) {
  const titles = wikiLinkTitles(contentMd);

  // Delete old outLinks
  await prisma.pageLink.deleteMany({ where: { sourceId } });

  if (titles.length === 0) return;

  // Resolve titles to IDs, excluding self. Prisma's `mode: 'insensitive'` only
  // exists for PostgreSQL/MongoDB (on MySQL it throws); MySQL's default
  // collation already compares case-insensitively.
  const targets = await prisma.page.findMany({
    where: {
      title: { in: titles },
      id: { not: sourceId },
    },
    select: { id: true },
  });

  if (targets.length === 0) return;

  // De-duplicate and insert
  const uniqueIds = [...new Set(targets.map((t) => t.id))];
  await prisma.pageLink.createMany({
    data: uniqueIds.map((targetId) => ({ sourceId, targetId })),
    skipDuplicates: true,
  });
}
