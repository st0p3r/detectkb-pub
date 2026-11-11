export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

/**
 * Line diff of two texts (longest common subsequence). Very long texts are
 * compared only between their common start and end, which is where edits are.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const same = (lines: string[]): DiffLine[] => lines.map((text) => ({ kind: 'same', text }));
  let middle: DiffLine[];
  if (x.length * y.length > 4_000_000) {
    // Too big to align line by line: everything between the common ends changed
    middle = [...x.map((text): DiffLine => ({ kind: 'del', text })), ...y.map((text): DiffLine => ({ kind: 'add', text }))];
  } else {
    const w = y.length + 1;
    const lcs = new Uint32Array((x.length + 1) * w);
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--) lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    middle = [];
    let i = 0;
    let j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) {
        middle.push({ kind: 'same', text: x[i] });
        i++;
        j++;
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) middle.push({ kind: 'del', text: x[i++] });
      else middle.push({ kind: 'add', text: y[j++] });
    }
    while (i < x.length) middle.push({ kind: 'del', text: x[i++] });
    while (j < y.length) middle.push({ kind: 'add', text: y[j++] });
  }
  return [...same(a.slice(0, start)), ...middle, ...same(a.slice(endA))];
}

/** The changed lines with `context` unchanged lines around them; null marks a gap. */
export function withContext(lines: DiffLine[], context = 2): (DiffLine | null)[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffLine | null)[] = [];
  lines.forEach((l, i) => {
    if (keep[i]) out.push(l);
    else if (out.length && out[out.length - 1] !== null) out.push(null);
  });
  if (out[out.length - 1] === null) out.pop();
  return out;
}
