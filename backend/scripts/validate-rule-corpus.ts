// Dry-run the rule importers over real rule repositories — nothing is written.
//
//   git clone --depth 1 https://github.com/splunk/security_content
//   git clone --depth 1 https://github.com/elastic/detection-rules
//   git clone --depth 1 https://github.com/SigmaHQ/sigma
//   npm run validate:corpus -- security_content/detections detection-rules/rules sigma/rules
//
// Reports per directory how many files parsed, and flags rules without ATT&CK
// techniques, without a query, or citing retired / unknown technique IDs.
import fs from 'fs';
import path from 'path';
import { parseRuleFile } from '../src/lib/rule-import';
import { REVOKED_TECHNIQUES, TECHNIQUE_BY_ID, parseTechniqueIds } from '../src/lib/attack';

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ya?ml|toml)$/i.test(entry.name)) yield full;
  }
}

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('usage: npm run validate:corpus -- <dir> [<dir> ...]');
  process.exit(1);
}

let failed = 0;
for (const dir of dirs) {
  const stats = { files: 0, rules: 0, noTechniques: 0, noQuery: 0, retired: new Map<string, number>(), unknown: new Map<string, number>() };
  const formats: Record<string, number> = {};
  const errors: Record<string, string[]> = {};
  for (const file of walk(dir)) {
    stats.files++;
    for (const entry of parseRuleFile(path.basename(file), fs.readFileSync(file, 'utf-8'))) {
      if (!entry.rule) {
        (errors[entry.error ?? 'error'] ??= []).push(path.relative(dir, file));
        continue;
      }
      const r = entry.rule;
      stats.rules++;
      formats[r.format] = (formats[r.format] ?? 0) + 1;
      if (!r.mitreTechniques) stats.noTechniques++;
      if (!r.splQuery && !r.nativeQuery && !r.sigmaYaml) stats.noQuery++;
      for (const id of parseTechniqueIds(r.mitreTechniques)) {
        if (TECHNIQUE_BY_ID.has(id)) continue;
        const bucket = REVOKED_TECHNIQUES[id] ? stats.retired : stats.unknown;
        bucket.set(id, (bucket.get(id) ?? 0) + 1);
      }
    }
  }
  const errorCount = Object.values(errors).reduce((n, l) => n + l.length, 0);
  failed += errorCount;
  console.log(`\n${dir}`);
  console.log(`  files: ${stats.files}  rules parsed: ${stats.rules}  errors: ${errorCount}  formats: ${JSON.stringify(formats)}`);
  console.log(`  without ATT&CK techniques: ${stats.noTechniques}  without query: ${stats.noQuery}`);
  if (stats.retired.size) {
    console.log(`  retired technique IDs (mapped to replacements): ${Array.from(stats.retired, ([id, n]) => `${id}→${REVOKED_TECHNIQUES[id]} ×${n}`).join(', ')}`);
  }
  if (stats.unknown.size) console.log(`  unknown technique IDs: ${Array.from(stats.unknown, ([id, n]) => `${id} ×${n}`).join(', ')}`);
  for (const [error, files] of Object.entries(errors)) {
    console.log(`  ✗ ${error} (${files.length}): ${files.slice(0, 5).join(', ')}${files.length > 5 ? ', …' : ''}`);
  }
}
process.exit(failed ? 1 : 0);
