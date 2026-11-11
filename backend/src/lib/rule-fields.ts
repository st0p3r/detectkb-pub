import { prisma } from './prisma';
import { parseSingleSigmaRule } from './sigma';

// Checks on rule fields that arrive in a request body, shared by the rule
// routes and the page save (lib/page-save.ts).

/**
 * Validates optional Sigma YAML from a request body. Returns the fields to
 * store, `{}` when sigmaYaml was not sent, or an error message.
 */
export async function sigmaFields(
  sigmaYaml: unknown,
  pageId: number
): Promise<{ sigmaYaml?: string | null; sigmaId?: string } | string> {
  if (sigmaYaml === undefined) return {};
  if (sigmaYaml === null || String(sigmaYaml).trim() === '') return { sigmaYaml: null };
  let doc;
  try {
    doc = parseSingleSigmaRule(String(sigmaYaml));
  } catch (err) {
    return (err as Error).message;
  }
  if (!doc.id) return { sigmaYaml: String(sigmaYaml) };
  const sigmaId = String(doc.id);
  const clash = await prisma.detectionRule.findFirst({ where: { sigmaId }, include: { page: true } });
  if (clash && clash.pageId !== pageId) return `Sigma id ${sigmaId} is already used by "${clash.page.title}"`;
  return { sigmaYaml: String(sigmaYaml), sigmaId };
}

/** ownerId from a request body: undefined (not sent), null (no owner) or an active user's id; a string is an error. */
export async function ownerField(value: unknown): Promise<{ ownerId?: number | null } | string> {
  if (value === undefined) return {};
  if (value === null || value === '') return { ownerId: null };
  const id = Number(value);
  if (!Number.isInteger(id)) return 'Invalid owner';
  const user = await prisma.user.findFirst({ where: { id, isActive: true }, select: { id: true } });
  return user ? { ownerId: id } : 'Unknown owner';
}

/** nextReviewAt from a request body: undefined (not sent), null (none) or a date; a string is an error. */
export function reviewDateField(value: unknown): { nextReviewAt?: Date | null } | string {
  if (value === undefined) return {};
  if (value === null || value === '') return { nextReviewAt: null };
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? 'Invalid review date' : { nextReviewAt: d };
}

export const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

