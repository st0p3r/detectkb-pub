#!/usr/bin/env node
// Regenerates src/data/attack-enterprise.json (tactics, techniques) and
// src/data/attack-cti.json (groups, software, mitigations) from MITRE's official
// STIX bundle.
//   node scripts/update-attack-data.js [path-or-url-to-enterprise-attack.json]
const fs = require('fs');
const path = require('path');

const DEFAULT_URL =
  'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';
const OUT = path.join(__dirname, '..', 'src', 'data', 'attack-enterprise.json');
const CTI_OUT = path.join(__dirname, '..', 'src', 'data', 'attack-cti.json');

async function load(src) {
  if (/^https?:/.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return res.json();
  }
  return JSON.parse(fs.readFileSync(src, 'utf-8'));
}

const externalId = (o) => o.external_references?.find((r) => r.source_name === 'mitre-attack')?.external_id;
const active = (o) => !o.revoked && !o.x_mitre_deprecated;

/** First sentences of a STIX description, without citations and markdown links. */
function summary(text, max = 420) {
  const clean = (text || '')
    .replace(/\(Citation:[^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<\/?code>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = cut.lastIndexOf('. ');
  return end > max / 3 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

(async () => {
  const bundle = await load(process.argv[2] || DEFAULT_URL);
  const objects = bundle.objects;

  const matrix = objects.find((o) => o.type === 'x-mitre-matrix' && active(o));
  const collection = objects.find((o) => o.type === 'x-mitre-collection');
  const tacticsById = new Map(objects.filter((o) => o.type === 'x-mitre-tactic' && active(o)).map((o) => [o.id, o]));
  const tactics = matrix.tactic_refs.map((ref) => {
    const t = tacticsById.get(ref);
    return { id: externalId(t), shortname: t.x_mitre_shortname, name: t.name };
  });

  const techniques = objects
    .filter((o) => o.type === 'attack-pattern' && active(o) && externalId(o))
    .map((o) => ({
      id: externalId(o),
      name: o.name,
      tactics: (o.kill_chain_phases || [])
        .filter((p) => p.kill_chain_name === 'mitre-attack')
        .map((p) => p.phase_name),
    }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

  // Revoked technique IDs → the technique that replaced them (e.g. T1562.001 → T1685),
  // so rules written against older ATT&CK releases still map onto the current matrix.
  const byStixId = new Map(objects.map((o) => [o.id, o]));
  const revoked = {};
  for (const rel of objects) {
    if (rel.type !== 'relationship' || rel.relationship_type !== 'revoked-by') continue;
    const from = byStixId.get(rel.source_ref);
    const to = byStixId.get(rel.target_ref);
    if (from?.type !== 'attack-pattern' || !to || !active(to)) continue;
    const fromId = externalId(from);
    const toId = externalId(to);
    if (fromId && toId && fromId !== toId) revoked[fromId] = toId;
  }

  // Threat groups, software (malware and tools) and mitigations, with the
  // techniques they use / mitigate. Revoked and deprecated objects are left out.
  const techniqueIds = new Set(techniques.map((t) => t.id));
  const uses = new Map(); // stix id → Set of target stix ids
  const addRel = (map, from, to) => {
    if (!map.has(from)) map.set(from, new Set());
    map.get(from).add(to);
  };
  const mitigates = new Map();
  for (const rel of objects) {
    if (rel.type !== 'relationship' || rel.revoked || rel.x_mitre_deprecated) continue;
    if (rel.relationship_type === 'uses') addRel(uses, rel.source_ref, rel.target_ref);
    if (rel.relationship_type === 'mitigates') addRel(mitigates, rel.source_ref, rel.target_ref);
  }
  const targets = (map, obj, type) =>
    Array.from(map.get(obj.id) || [])
      .map((ref) => byStixId.get(ref))
      .filter((t) => t && active(t) && (Array.isArray(type) ? type.includes(t.type) : t.type === type))
      .map(externalId)
      .filter(Boolean);
  const techniquesOf = (map, obj) =>
    Array.from(new Set(targets(map, obj, 'attack-pattern').filter((id) => techniqueIds.has(id)))).sort((a, b) =>
      a.localeCompare(b, 'en', { numeric: true })
    );
  const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });

  const groups = objects
    .filter((o) => o.type === 'intrusion-set' && active(o) && externalId(o))
    .map((o) => ({
      id: externalId(o),
      name: o.name,
      aliases: (o.aliases || []).filter((a) => a !== o.name),
      description: summary(o.description),
      techniques: techniquesOf(uses, o),
      software: Array.from(new Set(targets(uses, o, ['malware', 'tool']))).sort(),
    }))
    .sort(byId);
  const software = objects
    .filter((o) => (o.type === 'malware' || o.type === 'tool') && active(o) && externalId(o))
    .map((o) => ({
      id: externalId(o),
      name: o.name,
      type: o.type,
      aliases: (o.x_mitre_aliases || []).filter((a) => a !== o.name),
      platforms: o.x_mitre_platforms || [],
      description: summary(o.description),
      techniques: techniquesOf(uses, o),
    }))
    .sort(byId);
  const mitigations = objects
    .filter((o) => o.type === 'course-of-action' && active(o) && /^M\d{4}$/.test(externalId(o) || ''))
    .map((o) => ({ id: externalId(o), name: o.name, description: summary(o.description), techniques: techniquesOf(mitigates, o) }))
    .sort(byId);

  const out = { version: collection?.x_mitre_version || null, tactics, techniques, revoked };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  fs.writeFileSync(CTI_OUT, JSON.stringify({ version: out.version, groups, software, mitigations }) + '\n');
  console.log(`${groups.length} groups, ${software.length} software, ${mitigations.length} mitigations -> ${CTI_OUT}`);
  console.log(
    `ATT&CK v${out.version}: ${tactics.length} tactics, ${techniques.length} techniques, ` +
      `${Object.keys(revoked).length} revoked IDs -> ${OUT}`
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
