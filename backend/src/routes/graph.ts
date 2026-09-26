import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { TECHNIQUE_BY_ID, parseTechniqueIds, resolveTechniqueId } from '../lib/attack';
import { REFERENCE_KINDS, computeReferenceMatches } from '../lib/references';

const router = Router();

interface GraphNode {
  id: string;
  label: string;
  group: string; // page type (RULE, NOTE, ...) | technique | sysmon | tag | category | lolbas | gtfobins | loldrivers
  slug?: string;
  url?: string;
}

// GET /api/graph — knowledge graph: pages, wiki links, ATT&CK techniques,
// Sysmon events, tags, categories and attacker-tool references
router.get('/', async (_req, res) => {
  const [pages, links, sysmon, matches] = await Promise.all([
    prisma.page.findMany({
      select: {
        id: true,
        title: true,
        slug: true,
        type: true,
        category: { select: { id: true, name: true } },
        tags: { select: { tag: { select: { name: true } } } },
        rule: { select: { mitreTechniques: true } },
      },
    }),
    prisma.pageLink.findMany({ select: { sourceId: true, targetId: true } }),
    prisma.pageSysmonEvent.findMany({ select: { pageId: true, source: true, sysmonEvent: { select: { eventId: true, name: true } } } }),
    computeReferenceMatches(),
  ]);

  const nodes = new Map<string, GraphNode>();
  const edges: { source: string; target: string; kind: string }[] = [];
  const edge = (source: string, target: string, kind: string) => edges.push({ source, target, kind });

  for (const p of pages) {
    const id = `page:${p.id}`;
    nodes.set(id, { id, label: p.title, group: p.type, slug: p.slug });
    if (p.category) {
      const cid = `category:${p.category.id}`;
      nodes.set(cid, { id: cid, label: p.category.name, group: 'category' });
      edge(id, cid, 'category');
    }
    for (const { tag } of p.tags) {
      const tid = `tag:${tag.name}`;
      nodes.set(tid, { id: tid, label: `#${tag.name}`, group: 'tag' });
      edge(id, tid, 'tag');
    }
    for (const raw of parseTechniqueIds(p.rule?.mitreTechniques)) {
      const techId = resolveTechniqueId(raw);
      if (!techId) continue;
      const nid = `technique:${techId}`;
      nodes.set(nid, {
        id: nid,
        label: `${techId} ${TECHNIQUE_BY_ID.get(techId)?.name ?? ''}`.trim(),
        group: 'technique',
        url: `https://attack.mitre.org/techniques/${techId.replace('.', '/')}/`,
      });
      edge(id, nid, 'technique');
    }
  }
  for (const l of links) edge(`page:${l.sourceId}`, `page:${l.targetId}`, 'link');
  for (const s of sysmon) {
    const nid = `sysmon:${s.sysmonEvent.eventId}`;
    nodes.set(nid, { id: nid, label: `EID ${s.sysmonEvent.eventId} ${s.sysmonEvent.name}`, group: 'sysmon' });
    edge(`page:${s.pageId}`, nid, 'sysmon');
  }

  const refKeys = Array.from(matches.byPage.values()).flat();
  if (refKeys.length) {
    const entries = await prisma.referenceEntry.findMany({
      where: { OR: refKeys.map((r) => ({ kind: r.kind, key: r.key })) },
      select: { kind: true, key: true, name: true },
    });
    const names = new Map(entries.map((e) => [`${e.kind}:${e.key}`, e.name]));
    for (const [pageId, refs] of matches.byPage) {
      for (const r of refs) {
        const nid = `${r.kind}:${r.key}`;
        nodes.set(nid, { id: nid, label: `${names.get(nid) ?? r.key} (${REFERENCE_KINDS[r.kind].label})`, group: r.kind });
        edge(`page:${pageId}`, nid, 'reference');
      }
    }
  }

  res.json({ nodes: Array.from(nodes.values()), edges: edges.filter((e) => nodes.has(e.source) && nodes.has(e.target)) });
});

export default router;
