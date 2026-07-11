import slugify from 'slugify';
import { prisma } from './prisma';

export async function generateUniqueSlug(title: string, excludeId?: number): Promise<string> {
  const base = slugify(title, { lower: true, strict: true });
  let slug = base;
  let i = 1;
  while (true) {
    const existing = await prisma.page.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) break;
    slug = `${base}-${i++}`;
  }
  return slug;
}
