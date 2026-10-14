#!/usr/bin/env node
// Regenerates src/data/attack-enterprise.json (tactics, techniques) and
// src/data/attack-cti.json (groups, software, mitigations), the ATT&CK data
// bundled with DetectKB, from MITRE's official STIX bundle. (Running servers
// can also import a newer release in the app: Upstream Updates → MITRE ATT&CK.)
//   node scripts/update-attack-data.js [path-or-url-to-enterprise-attack.json]
const fs = require('fs');
const path = require('path');

require('ts-node').register({ transpileOnly: true });
const { convertStixBundle } = require('../src/lib/attack-stix');

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

(async () => {
  const { version, tactics, techniques, revoked, groups, software, mitigations } = convertStixBundle(await load(process.argv[2] || DEFAULT_URL));
  fs.writeFileSync(OUT, JSON.stringify({ version, tactics, techniques, revoked }) + '\n');
  fs.writeFileSync(CTI_OUT, JSON.stringify({ version, groups, software, mitigations }) + '\n');
  console.log(`${groups.length} groups, ${software.length} software, ${mitigations.length} mitigations -> ${CTI_OUT}`);
  console.log(
    `ATT&CK v${version}: ${tactics.length} tactics, ${techniques.length} techniques, ` +
      `${Object.keys(revoked).length} revoked IDs -> ${OUT}`
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
