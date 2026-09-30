import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// MITRE D3FEND countermeasures for an ATT&CK technique, from the D3FEND API
// (https://d3fend.mitre.org/api/offensive-technique/attack/T1003.json), fetched
// on first use and cached in the database. D3FEND_FETCH=false disables fetching
// (e.g. offline servers); the D3FEND page link is always offered.

export interface D3fendCountermeasure {
  /** D3FEND technique, e.g. "Credential Hardening" */
  name: string;
  /** D3FEND tactic, e.g. "Harden", "Detect", "Isolate" */
  tactic: string | null;
  /** The digital artifact it acts on, e.g. "Process" */
  artifact: string | null;
  url: string | null;
}

export interface D3fendResult {
  techniqueId: string;
  pageUrl: string;
  available: boolean;
  countermeasures: D3fendCountermeasure[];
  fetchedAt: string | null;
  error?: string;
}

const API = 'https://d3fend.mitre.org/api/offensive-technique/attack';
const CACHE_DAYS = 30;

export const d3fendPageUrl = (id: string) => `https://d3fend.mitre.org/offensive-technique/attack/${id}/`;

type Binding = Record<string, { value?: unknown } | undefined>;

/** SPARQL-style result bindings anywhere in the response. */
function findBindings(json: unknown, depth = 0): Binding[] {
  if (!json || typeof json !== 'object' || depth > 4) return [];
  const obj = json as Record<string, unknown>;
  const results = obj.results as { bindings?: unknown } | undefined;
  if (results && Array.isArray(results.bindings)) return results.bindings as Binding[];
  return Object.values(obj).flatMap((v) => findBindings(v, depth + 1));
}

const val = (b: Binding, ...names: string[]) => {
  for (const n of names) {
    const v = b[n]?.value;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
};

/** The countermeasures in a D3FEND API response (unique by name). */
export function parseD3fendResponse(json: unknown): D3fendCountermeasure[] {
  const byName = new Map<string, D3fendCountermeasure>();
  for (const b of findBindings(json)) {
    const name = val(b, 'def_tech_label', 'def_tech_name', 'countermeasure_label');
    if (!name || byName.has(name)) continue;
    const uri = val(b, 'def_tech', 'def_tech_uri');
    const cls = uri?.includes('#') ? uri.slice(uri.indexOf('#') + 1) : null;
    byName.set(name, {
      name,
      tactic: val(b, 'def_tactic_label', 'def_tactic_name'),
      artifact: val(b, 'def_artifact_label', 'off_artifact_label'),
      url: cls ? `https://d3fend.mitre.org/technique/d3f:${cls}/` : null,
    });
  }
  return Array.from(byName.values()).sort((a, b) => (a.tactic ?? '').localeCompare(b.tactic ?? '') || a.name.localeCompare(b.name));
}

/** D3FEND countermeasures for a technique: cached, or fetched when missing / stale. */
export async function getD3fend(techniqueId: string): Promise<D3fendResult> {
  const base = { techniqueId, pageUrl: d3fendPageUrl(techniqueId) };
  const cached = await prisma.d3fendMapping.findUnique({ where: { techniqueId } });
  const fresh = cached && Date.now() - cached.fetchedAt.getTime() < CACHE_DAYS * 86400_000;
  if (cached && (fresh || process.env.D3FEND_FETCH === 'false')) {
    return { ...base, available: true, countermeasures: cached.data as unknown as D3fendCountermeasure[], fetchedAt: cached.fetchedAt.toISOString() };
  }
  if (process.env.D3FEND_FETCH === 'false') {
    return { ...base, available: false, countermeasures: [], fetchedAt: null, error: 'D3FEND fetching is disabled on this server' };
  }
  try {
    const res = await fetch(`${API}/${encodeURIComponent(techniqueId)}.json`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`d3fend.mitre.org returned HTTP ${res.status}`);
    const countermeasures = parseD3fendResponse(await res.json());
    const row = await prisma.d3fendMapping.upsert({
      where: { techniqueId },
      create: { techniqueId, data: countermeasures as unknown as Prisma.InputJsonValue },
      update: { data: countermeasures as unknown as Prisma.InputJsonValue, fetchedAt: new Date() },
    });
    return { ...base, available: true, countermeasures, fetchedAt: row.fetchedAt.toISOString() };
  } catch (err) {
    // Serve a stale copy rather than nothing
    if (cached) {
      return { ...base, available: true, countermeasures: cached.data as unknown as D3fendCountermeasure[], fetchedAt: cached.fetchedAt.toISOString() };
    }
    return { ...base, available: false, countermeasures: [], fetchedAt: null, error: `Could not reach D3FEND: ${(err as Error).message}` };
  }
}
