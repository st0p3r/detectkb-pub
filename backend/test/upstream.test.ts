import zlib from 'zlib';
import { describe, expect, it } from 'vitest';
import { readTarGz, readZip, stripTopFolder } from '../src/lib/archive';
import { isRelevant, ruleTelemetry, sourceDef } from '../src/lib/upstream';
import { parseRuleFile } from '../src/lib/rule-import';

// ── Tiny archive writers for the tests ──────────────────────────────────────

function zip(entries: { name: string; content: string; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.content);
    const data = e.deflate ? zlib.deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function tarHeader(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write(type, 156);
  h.write('ustar\0', 257);
  return h;
}
const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);

function tarGz(entries: { name: string; content: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.content);
    if (e.name.length > 100) {
      // pax extended header with the full path, as GitHub archives use
      const rec = ` path=${e.name}\n`;
      let len = rec.length + 2;
      len = String(len).length + rec.length;
      const pax = Buffer.from(`${len}${rec}`);
      parts.push(tarHeader('PaxHeader', pax.length, 'x'), pad(pax));
    }
    parts.push(tarHeader(e.name, data.length, '0'), pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

const SIGMA = `title: Suspicious LSASS Access
id: 5ef9853e-4d0e-4a70-846f-a9ca37d876da
status: test
logsource:
  category: process_access
  product: windows
detection:
  selection:
    TargetImage|endswith: '\\\\lsass.exe'
  condition: selection
level: high
tags:
  - attack.credential-access
  - attack.t1003.001
`;

describe('readZip', () => {
  it('extracts stored and deflated entries the filter accepts', () => {
    const buf = zip([
      { name: 'rules/windows/a.yml', content: 'a: 1', deflate: true },
      { name: 'rules/windows/b.yml', content: 'b: 2' },
      { name: 'README.md', content: '#' },
      { name: 'rules/', content: '' },
    ]);
    const files = readZip(buf, { filter: (p) => p.endsWith('.yml') });
    expect(files).toEqual([
      { path: 'rules/windows/a.yml', content: 'a: 1' },
      { path: 'rules/windows/b.yml', content: 'b: 2' },
    ]);
  });

  it('skips unsafe paths and oversized files, rejects non-zips', () => {
    const buf = zip([
      { name: '../evil.yml', content: 'x' },
      { name: 'big.yml', content: 'x'.repeat(100) },
      { name: 'ok.yml', content: 'y' },
    ]);
    expect(readZip(buf, { filter: () => true, maxFileBytes: 50 }).map((f) => f.path)).toEqual(['ok.yml']);
    expect(() => readZip(Buffer.from('not a zip at all, definitely not'), { filter: () => true })).toThrow(/zip/);
  });
});

describe('readTarGz', () => {
  it('reads regular files, with pax long names, and strips the top folder', () => {
    const long = `repo-main/detections/endpoint/${'x'.repeat(120)}/rule.yml`;
    const buf = tarGz([
      { name: 'repo-main/detections/endpoint/a.yml', content: 'a: 1' },
      { name: long, content: 'b: 2' },
      { name: 'repo-main/README.md', content: '#' },
    ]);
    const files = readTarGz(buf, { filter: (p) => p.endsWith('.yml') });
    expect(files.map((f) => f.path)).toEqual(['repo-main/detections/endpoint/a.yml', long]);
    expect(files[1].content).toBe('b: 2');
    expect(stripTopFolder(files[0].path)).toBe('detections/endpoint/a.yml');
  });

  it('skips path traversal', () => {
    const buf = tarGz([{ name: 'repo/../../etc/x.yml', content: 'x' }]);
    expect(readTarGz(buf, { filter: () => true })).toEqual([]);
  });
});

describe('source filters', () => {
  it('take detections and rules, not deprecated ones', () => {
    const escu = sourceDef('escu')!.filter!;
    expect(escu('security_content-develop/detections/endpoint/a.yml')).toBe(true);
    expect(escu('security_content-develop/detections/deprecated/a.yml')).toBe(false);
    expect(escu('security_content-develop/stories/a.yml')).toBe(false);
    const elastic = sourceDef('elastic')!.filter!;
    expect(elastic('detection-rules-main/rules/windows/a.toml')).toBe(true);
    expect(elastic('detection-rules-main/rules/_deprecated/a.toml')).toBe(false);
    const sigma = sourceDef('sigma')!.filter!;
    expect(sigma('rules/windows/process_access/a.yml')).toBe(true);
    expect(sigma('deprecated/windows/a.yml')).toBe(false);
  });
});

describe('relevance', () => {
  const rule = parseRuleFile('lsass.yml', SIGMA)[0].rule!;

  it('derives the telemetry of a parsed rule', () => {
    expect(ruleTelemetry(rule).telemetry).toContain('sysmon:10');
  });

  it('is relevant when one way of feeding the rule is in use', () => {
    const t = ruleTelemetry(rule);
    expect(isRelevant(t, new Set(['sysmon:10', 'windows-security:4688']))).toBe(true);
    expect(isRelevant(t, new Set(['windows-security:4688']))).toBe(false);
    expect(isRelevant({ telemetry: [], groups: [] }, new Set(['sysmon:10']))).toBe(false);
  });

  it('honours AND groups and "any event" keys', () => {
    const t = { telemetry: ['sysmon:1', 'sysmon:11'], groups: [['sysmon:1', 'sysmon:11']] };
    expect(isRelevant(t, new Set(['sysmon:1']))).toBe(false);
    expect(isRelevant(t, new Set(['sysmon:1', 'sysmon:11']))).toBe(true);
    expect(isRelevant({ telemetry: ['crowdstrike:processrollup2'], groups: [] }, new Set(['crowdstrike:*']))).toBe(true);
  });
});
