import { Prisma } from '@prisma/client';
import { kbCache, markDataChanged } from './kb-cache';
import { prisma } from './prisma';
import { parseTechniqueIds, resolveTechniqueId } from './attack';

// Attacker-tool references and their automatic matching against detection rules.
//   lolbas     — Living Off The Land Binaries, Scripts and Libraries (Windows)
//   gtfobins   — Unix binaries abusable to bypass local security restrictions
//   loldrivers — vulnerable / malicious Windows drivers

export type ReferenceKind = 'lolbas' | 'gtfobins' | 'loldrivers';

export const REFERENCE_KINDS: Record<ReferenceKind, { label: string; url: string; site: string; license: string }> = {
  lolbas: {
    label: 'LOLBAS',
    url: 'https://lolbas-project.github.io/api/lolbas.json',
    site: 'https://lolbas-project.github.io/',
    license: 'GPL-3.0',
  },
  gtfobins: {
    label: 'GTFOBins',
    url: 'https://gtfobins.github.io/api.json',
    site: 'https://gtfobins.github.io/',
    license: 'GPL-3.0',
  },
  loldrivers: {
    label: 'LOLDrivers',
    url: 'https://www.loldrivers.io/api/drivers.json',
    site: 'https://www.loldrivers.io/',
    license: 'Apache-2.0',
  },
};

export const isReferenceKind = (k: string): k is ReferenceKind => k in REFERENCE_KINDS;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const uniq = <T,>(items: T[]) => Array.from(new Set(items.filter((x) => x !== '' && x !== null && x !== undefined)));

export interface NormalizedEntry {
  key: string;
  name: string;
  data: Obj;
}

// ── Normalisers (input = the project's official API JSON) ───────────────────

function lolbasType(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'exe') return 'Binary';
  if (ext === 'dll') return 'Library';
  return 'Script';
}

export function normalizeLolbas(json: unknown): NormalizedEntry[] {
  if (!Array.isArray(json)) throw new Error('LOLBAS data must be a JSON array (api/lolbas.json)');
  return json.filter(isObj).filter((e) => str(e.Name)).map((e) => {
    const name = str(e.Name);
    const commands = list(e.Commands).filter(isObj).map((c) => ({
      command: str(c.Command),
      description: str(c.Description),
      usecase: str(c.Usecase),
      category: str(c.Category),
      privileges: str(c.Privileges),
      mitre: str(c.MitreID),
      os: str(c.OperatingSystem),
    }));
    return {
      key: name.toLowerCase(),
      name,
      data: {
        description: str(e.Description),
        type: lolbasType(name),
        categories: uniq(commands.map((c) => c.category)),
        mitre: uniq(commands.map((c) => c.mitre)),
        commands,
        paths: list(e.Full_Path).filter(isObj).map((p) => str(p.Path)).filter(Boolean),
        detections: list(e.Detection)
          .filter(isObj)
          .flatMap((d) => Object.entries(d).map(([type, value]) => ({ type, value: str(value) })))
          .filter((d) => d.value),
        resources: list(e.Resources).filter(isObj).map((r) => str(r.Link)).filter(Boolean),
      },
    };
  });
}

export function normalizeGtfobins(json: unknown): NormalizedEntry[] {
  if (!isObj(json) || !isObj(json.executables)) throw new Error('GTFOBins data must be the api.json object');
  const fnInfo = isObj(json.functions) ? json.functions : {};
  return Object.entries(json.executables).map(([name, raw]) => {
    const exe = isObj(raw) ? raw : {};
    const functions = Object.entries(isObj(exe.functions) ? exe.functions : {}).map(([fn, examples]) => {
      const info = isObj(fnInfo[fn]) ? (fnInfo[fn] as Obj) : {};
      return {
        id: fn,
        label: str(info.label) || fn,
        mitre: list(info.mitre).map(str),
        examples: list(examples).filter(isObj).slice(0, 3).map((ex) => ({
          code: str(ex.code),
          comment: str(ex.comment),
          contexts: isObj(ex.contexts) ? Object.keys(ex.contexts) : [],
        })),
      };
    });
    return {
      key: name.toLowerCase(),
      name,
      data: {
        comment: str(exe.comment),
        alias: str(exe.alias),
        functions,
        categories: functions.map((f) => f.label),
        mitre: uniq(functions.flatMap((f) => f.mitre)),
        contexts: uniq(functions.flatMap((f) => f.examples.flatMap((e) => e.contexts))),
      },
    };
  });
}

export function normalizeLoldrivers(json: unknown): NormalizedEntry[] {
  if (!Array.isArray(json)) throw new Error('LOLDrivers data must be a JSON array (api/drivers.json)');
  return json.filter(isObj).filter((e) => str(e.Id)).map((e) => {
    const samples = list(e.KnownVulnerableSamples).filter(isObj);
    const commands = list(e.Commands).filter(isObj);
    const tags = list(e.Tags).map(str);
    const filenames = uniq(
      [...tags, ...samples.flatMap((s) => [str(s.Filename), str(s.OriginalFilename)])].map((f) => f.toLowerCase())
    ).filter((f) => f.endsWith('.sys'));
    const name = tags[0] || filenames[0] || str(e.Id);
    return {
      key: str(e.Id).toLowerCase(),
      name,
      data: {
        category: str(e.Category),
        verified: str(e.Verified).toUpperCase() === 'TRUE',
        created: str(e.Created),
        mitre: uniq([str(e.MitreID)]),
        description: str(commands[0]?.Description).slice(0, 1500),
        usecase: str(commands[0]?.Usecase),
        command: str(commands[0]?.Command),
        filenames,
        companies: uniq(samples.map((s) => str(s.Company))).slice(0, 10),
        products: uniq(samples.map((s) => str(s.Product))).slice(0, 10),
        hashes: uniq(
          samples.flatMap((s) => [str(s.SHA256), str(s.SHA1), str(s.MD5)]).map((h) => h.toLowerCase())
        ).filter((h) => /^[0-9a-f]{32,64}$/.test(h)),
        sampleCount: samples.length,
        resources: list(e.Resources).map(str).filter(Boolean).slice(0, 15),
      },
    };
  });
}

const NORMALIZERS: Record<ReferenceKind, (json: unknown) => NormalizedEntry[]> = {
  lolbas: normalizeLolbas,
  gtfobins: normalizeGtfobins,
  loldrivers: normalizeLoldrivers,
};

// ── Storage ──────────────────────────────────────────────────────────────────

/** Replaces a dataset with the given official-API JSON. Returns the number of entries. */
export async function storeReferenceData(kind: ReferenceKind, json: unknown, source: string): Promise<number> {
  const entries = NORMALIZERS[kind](json);
  if (!entries.length) throw new Error(`No ${REFERENCE_KINDS[kind].label} entries found`);
  // Duplicate keys (e.g. case variants) — keep the first
  const unique = Array.from(new Map(entries.map((e) => [e.key, e])).values());

  await prisma.$transaction(
    async (tx) => {
      await tx.referenceEntry.deleteMany({ where: { kind } });
      for (let i = 0; i < unique.length; i += 200) {
        await tx.referenceEntry.createMany({
          data: unique.slice(i, i + 200).map((e) => ({
            kind,
            key: e.key.slice(0, 191),
            name: e.name.slice(0, 255),
            data: e.data as Prisma.InputJsonValue,
          })),
        });
      }
      await tx.referenceDataset.upsert({
        where: { kind },
        create: { kind, source, count: unique.length },
        update: { source, count: unique.length, fetchedAt: new Date() },
      });
    },
    { timeout: 60000 }
  );
  markDataChanged();
  return unique.length;
}

/** Downloads a dataset from its official API. */
export async function fetchReferenceData(kind: ReferenceKind): Promise<number> {
  const { url } = REFERENCE_KINDS[kind];
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return storeReferenceData(kind, await res.json(), url);
}

// ── Matching references against rules ───────────────────────────────────────

export interface MatchedRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LINUX_HINT = /linux|macos|darwin|\/bin\/|\/usr\/|auditd|host\.os\.type\s*(?:==|:)\s*"(?:linux|macos)"/i;

interface Matcher {
  kind: ReferenceKind;
  /** name token (lowercase) → entry keys */
  tokens: Map<string, string[]>;
  pathRegex: RegExp | null;
  quotedRegex: RegExp | null;
  hashes: Map<string, string>;
}

function buildMatchers(entries: { kind: string; key: string; name: string; data: Prisma.JsonValue }[]): Matcher[] {
  const byKind = new Map<ReferenceKind, Matcher>();
  for (const k of Object.keys(REFERENCE_KINDS) as ReferenceKind[]) {
    byKind.set(k, { kind: k, tokens: new Map(), pathRegex: null, quotedRegex: null, hashes: new Map() });
  }
  const add = (m: Matcher, token: string, key: string) => {
    const t = token.toLowerCase();
    if (!t) return;
    m.tokens.set(t, [...(m.tokens.get(t) ?? []), key]);
  };
  for (const e of entries) {
    const m = byKind.get(e.kind as ReferenceKind);
    if (!m) continue;
    const data = (isObj(e.data) ? e.data : {}) as Obj;
    if (e.kind === 'lolbas') add(m, e.name, e.key);
    if (e.kind === 'gtfobins') add(m, e.name, e.key);
    if (e.kind === 'loldrivers') {
      for (const f of list(data.filenames)) add(m, str(f), e.key);
      for (const h of list(data.hashes)) m.hashes.set(str(h), e.key);
    }
  }
  for (const m of byKind.values()) {
    if (!m.tokens.size) continue;
    // Longest first so "python3" wins over "python"
    const alt = Array.from(m.tokens.keys()).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    if (m.kind === 'gtfobins') {
      // Unix names are ordinary words ("find", "env"): only match path-like
      // (/usr/bin/find, */find) or, in Linux rules, quoted process names ("find").
      // Case-sensitive (Unix paths are) and never after another "/" — that is a
      // comment ("//Find the …") or URL, not a path.
      m.pathRegex = new RegExp(`(?<![/:])/(${alt})(?![\\w.+-])`, 'g');
      m.quotedRegex = new RegExp(`["'](${alt})["']`, 'g');
    } else {
      // Windows names carry an extension (certutil.exe, rtcore64.sys)
      m.pathRegex = new RegExp(`(?<![\\w.-])(${alt})(?![\\w.-])`, 'gi');
    }
  }
  return Array.from(byKind.values());
}

/** Entry keys (per kind) referenced by a rule's text. */
export function matchText(matchers: Matcher[], text: string): Map<ReferenceKind, Set<string>> {
  const found = new Map<ReferenceKind, Set<string>>();
  const add = (kind: ReferenceKind, keys: string[] | undefined) => {
    if (!keys?.length) return;
    if (!found.has(kind)) found.set(kind, new Set());
    keys.forEach((k) => found.get(kind)!.add(k));
  };
  const linux = LINUX_HINT.test(text);
  for (const m of matchers) {
    if (m.pathRegex) for (const x of text.matchAll(m.pathRegex)) add(m.kind, m.tokens.get(x[1].toLowerCase()));
    if (m.quotedRegex && linux) for (const x of text.matchAll(m.quotedRegex)) add(m.kind, m.tokens.get(x[1].toLowerCase()));
    if (m.hashes.size) {
      for (const h of text.toLowerCase().match(/\b[0-9a-f]{32}(?:[0-9a-f]{8})?(?:[0-9a-f]{24})?\b/g) ?? []) {
        const key = m.hashes.get(h);
        if (key) add(m.kind, [key]);
      }
    }
  }
  return found;
}

export interface ReferenceMatches {
  byEntry: Map<string, MatchedRule[]>;
  byPage: Map<number, { kind: ReferenceKind; key: string }[]>;
  /** "kind:key" → entry name, for every entry (so callers needn't query names) */
  names: Map<string, string>;
  /** "kind:key" → the current ATT&CK technique IDs the entry maps to */
  techniques: Map<string, string[]>;
}

const matchesCache = kbCache(buildReferenceMatches);

/** For every rule: which reference entries it mentions (cached until data changes). */
export function computeReferenceMatches(): Promise<ReferenceMatches> {
  return matchesCache.get();
}

async function buildReferenceMatches(): Promise<ReferenceMatches> {
  const [entries, rules] = await Promise.all([
    prisma.referenceEntry.findMany({ select: { kind: true, key: true, name: true, data: true } }),
    prisma.detectionRule.findMany({
      select: {
        status: true,
        severity: true,
        splQuery: true,
        nativeQuery: true,
        sigmaYaml: true,
        page: { select: { id: true, title: true, slug: true } },
      },
    }),
  ]);
  const matchers = buildMatchers(entries);
  const byEntry = new Map<string, MatchedRule[]>();
  const byPage = new Map<number, { kind: ReferenceKind; key: string }[]>();
  for (const r of rules) {
    const text = [r.page.title, r.splQuery, r.nativeQuery ?? '', r.sigmaYaml ?? ''].join('\n');
    for (const [kind, keys] of matchText(matchers, text)) {
      for (const key of keys) {
        const id = `${kind}:${key}`;
        if (!byEntry.has(id)) byEntry.set(id, []);
        byEntry.get(id)!.push({ pageId: r.page.id, title: r.page.title, slug: r.page.slug, status: r.status, severity: r.severity });
        if (!byPage.has(r.page.id)) byPage.set(r.page.id, []);
        byPage.get(r.page.id)!.push({ kind, key });
      }
    }
  }
  const names = new Map(entries.map((e) => [`${e.kind}:${e.key}`, e.name]));
  const techniques = new Map<string, string[]>();
  for (const e of entries) {
    const ids = Array.from(
      new Set(entryTechniques((e.data ?? {}) as Obj).map(resolveTechniqueId).filter((t): t is string => !!t))
    );
    if (ids.length) techniques.set(`${e.kind}:${e.key}`, ids);
  }
  return { byEntry, byPage, names, techniques };
}

/** ATT&CK techniques an entry maps to (for display). */
export function entryTechniques(data: Obj): string[] {
  return parseTechniqueIds(list(data.mitre).map(str).join(' '));
}

/** Internal helpers exposed for unit tests. */
export const __test = { buildMatchers };
