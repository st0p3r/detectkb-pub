/**
 * Returns the URL only when it is an absolute http(s) link. Links that come
 * from data (rule references, imported datasets, story files) could otherwise
 * carry `javascript:` or `data:` URLs, which React 18 still renders.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  const u = url?.trim();
  if (!u) return undefined;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}
