import zlib from 'zlib';

// Minimal readers for the two archive formats upstream rule repositories come
// in: .zip (Sigma release packages) and .tar.gz (GitHub source archives).
// Only regular files the filter accepts are extracted, with size limits.

export interface ArchiveFile {
  path: string;
  content: string;
}

export interface ExtractOptions {
  /** Which paths to extract */
  filter: (path: string) => boolean;
  /** Per file, bytes (larger files are skipped) */
  maxFileBytes?: number;
  /** All extracted files together, bytes */
  maxTotalBytes?: number;
}

const DEFAULTS = { maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 300 * 1024 * 1024 };

/** Rejects absolute paths and "..": entries are only ever used as names, but stay safe. */
const safePath = (p: string) => !!p && !p.startsWith('/') && !p.split('/').includes('..');

export function readZip(buf: Buffer, opts: ExtractOptions): ArchiveFile[] {
  const { filter, maxFileBytes, maxTotalBytes } = { ...DEFAULTS, ...opts };
  // End of central directory: signature 0x06054b50 within the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ArchiveFile[] = [];
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const path = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith('/') || !safePath(path) || !filter(path) || size > maxFileBytes) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('Corrupt zip entry');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    let content: Buffer;
    if (method === 0) content = data;
    else if (method === 8) content = zlib.inflateRawSync(data, { maxOutputLength: maxFileBytes + 1 });
    else continue;
    total += content.length;
    if (total > maxTotalBytes) throw new Error('Archive too large');
    out.push({ path, content: content.toString('utf8') });
  }
  return out;
}

/** Parses a pax extended header ("<len> key=value\n" records). */
function paxRecords(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < data.length) {
    const space = data.indexOf(0x20, i);
    if (space < 0) break;
    const len = Number(data.toString('utf8', i, space));
    if (!len) break;
    const record = data.toString('utf8', space + 1, i + len - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

const cstr = (b: Buffer, start: number, len: number) => {
  const s = b.subarray(start, start + len);
  const end = s.indexOf(0);
  return s.toString('utf8', 0, end < 0 ? s.length : end);
};

export function readTarGz(buf: Buffer, opts: ExtractOptions): ArchiveFile[] {
  const { filter, maxFileBytes, maxTotalBytes } = { ...DEFAULTS, ...opts };
  const tar = zlib.gunzipSync(buf, { maxOutputLength: maxTotalBytes * 2 });
  const out: ArchiveFile[] = [];
  let total = 0;
  let longName: string | null = null;
  let i = 0;
  while (i + 512 <= tar.length) {
    const header = tar.subarray(i, i + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(cstr(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = cstr(header, 345, 155);
    const name = cstr(header, 0, 100);
    const dataStart = i + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    i = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      longName = paxRecords(data).path ?? null;
      continue;
    }
    if (type === 'L') {
      longName = cstr(data, 0, data.length);
      continue;
    }
    if (type === 'g') continue;
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    if ((type !== '0' && type !== '\0') || !safePath(path) || !filter(path) || size > maxFileBytes) continue;
    total += size;
    if (total > maxTotalBytes) throw new Error('Archive too large');
    out.push({ path, content: data.toString('utf8') });
  }
  return out;
}

/** Strips the top folder GitHub puts in source archives ("security_content-develop/"). */
export const stripTopFolder = (path: string) => path.slice(path.indexOf('/') + 1);
