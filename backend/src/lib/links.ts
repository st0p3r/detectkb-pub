import { prisma } from './prisma';

export async function syncPageLinks(sourceId: number, contentMd: string) {
  const regex = /\[\[([^\]]+)\]\]/g;
  const titles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(contentMd)) !== null) {
    titles.push(m[1].trim());
  }

  // Delete old outLinks
  await prisma.pageLink.deleteMany({ where: { sourceId } });

  if (titles.length === 0) return;

  // Resolve titles to IDs (case-insensitive, exclude self)
  // MySQL does not support mode:'insensitive' on `in` filters in Prisma,
  // so we use OR with individual contains filters.
  const targets = await prisma.page.findMany({
    where: {
      OR: titles.map((t) => ({ title: { equals: t, mode: 'insensitive' as const } })),
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
