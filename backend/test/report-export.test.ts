import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { description, referenceItems, tacticNames, techniqueLines } from '../src/services/report-content';
import { renderDetectionReport, renderMatrixPdf, renderPagePdf } from '../src/services/pdf/reports';
import { isRtl } from '../src/services/pdf/ReportPdf';

const rule = {
  id: 1,
  page: { title: 'Java Payload Strings', contentMd: 'Detects Java payloads in URLs.\n\n## Investigation guide\n\nLong text.', tags: [{ tag: { name: 'web' } }] },
  severity: 'high',
  status: 'production',
  sourceFormat: 'sigma',
  mitreTactics: 'TA0001',
  mitreTechniques: 'T1190, T1562',
  dataSource: 'category:webserver',
  splQuery: '"${(#a=@" OR "getRuntime().exec("',
  falsePositives: 'Legitimate apps',
  references: 'https://example.com/a\n[Blog](https://example.com/b)\nInternal wiki',
};

describe('report content', () => {
  it('names tactics and techniques, showing retired IDs under their replacement', () => {
    expect(tacticNames(rule)).toEqual(['Initial Access (TA0001)']);
    expect(tacticNames({ mitreTechniques: 'T1059.001' })).toEqual(['Execution (TA0002)']);
    expect(techniqueLines(rule.mitreTechniques)[0]).toBe('T1190  Exploit Public-Facing Application');
    expect(techniqueLines('T1562')[0]).toMatch(/^T1685 .*\(written as T1562\)$/);
  });

  it('takes the description before the first heading, and turns references into links', () => {
    expect(description(rule.page.contentMd)).toBe('Detects Java payloads in URLs.');
    expect(referenceItems(rule.references)).toEqual([
      { text: 'https://example.com/a', link: 'https://example.com/a' },
      { text: 'Blog — https://example.com/b', link: 'https://example.com/b' },
      { text: 'Internal wiki' },
    ]);
  });

  it('tells right-to-left paragraphs', () => {
    expect(isRtl('قانون Sysmon رویداد 10')).toBe(true);
    expect(isRtl('Sysmon رویداد')).toBe(false);
    expect(isRtl('plain')).toBe(false);
  });
});

describe('PDF exports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detectkb-pdf-'));
  const isPdf = (file: string) => fs.readFileSync(file).subarray(0, 5).toString() === '%PDF-';

  it('renders the report, a page (Persian too) and the matrix', async () => {
    const report = await renderDetectionReport(path.join(dir, 'r.pdf'), 'Report', [{ id: 9, title: 'یادداشت', type: 'NOTE', contentMd: '## خلاصه\n\n- مورد اول\n\n| منبع | رویداد |\n|---|---|\n| Sysmon | 10 |' }], [rule, { ...rule, id: 2, splQuery: 'x\n'.repeat(400) }]);
    expect(isPdf(report)).toBe(true);
    expect(isPdf(await renderPagePdf(path.join(dir, 'p.pdf'), { id: 1, title: 'A page', type: 'RULE', contentMd: 'Body', rule }))).toBe(true);
    expect(isPdf(await renderMatrixPdf(path.join(dir, 'm.pdf'), 'Matrix', [rule, { severity: null, mitreTechniques: null }]))).toBe(true);
  });
});
