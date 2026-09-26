#!/usr/bin/env node
// Regenerates src/data/attack-enterprise.json from MITRE's official STIX bundle.
//   node scripts/update-attack-data.js [path-or-url-to-enterprise-attack.json]
const fs = require('fs');
const path = require('path');

const DEFAULT_URL =
  'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';
const OUT = path.join(__dirname, '..', 'src', 'data', 'attack-enterprise.json');

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

  const out = { version: collection?.x_mitre_version || null, tactics, techniques, revoked };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(
    `ATT&CK v${out.version}: ${tactics.length} tactics, ${techniques.length} techniques, ` +
      `${Object.keys(revoked).length} revoked IDs -> ${OUT}`
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
