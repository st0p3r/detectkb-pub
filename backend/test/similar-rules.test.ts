import { describe, expect, it } from 'vitest';
import { groupSimilar, similarity, tokens } from '../src/lib/similar-rules';

const rule = (pageId: number, title: string, techniques: string[], telemetry: string[], extra: Partial<{ status: string; sourceFormat: string | null }> = {}) => ({
  pageId,
  title,
  slug: `r${pageId}`,
  status: 'production',
  severity: 'high',
  sourceFormat: 'escu',
  techniques,
  telemetry,
  ...extra,
});

describe('similar rules', () => {
  it('tokenizes queries into lower-case words, keeping paths and dotted names', () => {
    expect(tokens('Image="C:\\Windows\\rundll32.exe" -EncodedCommand | tstats by a.bc, x')).toEqual(
      new Set(['image', 'windows\\rundll32.exe', 'encodedcommand', 'tstats', 'a.bc'])
    );
  });

  it('weights rare shared words more than common ones', () => {
    const common = (t: string) => (t === 'tstats' ? 0.1 : 1);
    expect(similarity(new Set(['tstats', 'rundll32']), new Set(['tstats', 'mshta']), common)).toBeCloseTo(0.1 / 2.1);
    expect(similarity(new Set(['a']), new Set(['a']), () => 1)).toBe(1);
    expect(similarity(new Set(), new Set(), () => 1)).toBe(0);
  });

  it('groups active rules with identical techniques and telemetry, most similar first', () => {
    const rules = [
      rule(1, 'Rundll32 no args', ['T1218.011'], ['sysmon:1', 'windows-security:4688']),
      rule(2, 'Rundll32 without arguments', ['T1218.011'], ['windows-security:4688', 'sysmon:1'], { sourceFormat: 'sigma' }),
      rule(3, 'Something else', ['T1218.011'], ['sysmon:1']),
      rule(4, 'Old one', ['T1218.011'], ['sysmon:1', 'windows-security:4688'], { status: 'deprecated' }),
      rule(5, 'No telemetry', ['T1218.011'], []),
      rule(6, 'Encoded PowerShell', ['T1059.001'], ['sysmon:1']),
      rule(7, 'PowerShell download cradle', ['T1059.001'], ['sysmon:1']),
    ];
    const texts = new Map([
      [1, 'process_name=rundll32.exe cmdline_args=none'],
      [2, 'Image|endswith rundll32.exe CommandLine none'],
      [6, 'powershell.exe -encodedcommand'],
      [7, 'powershell.exe downloadstring iex'],
    ]);
    const groups = groupSimilar(rules, texts);
    expect(groups.map((g) => g.rules.map((r) => r.pageId).sort())).toEqual([
      [1, 2],
      [6, 7],
    ]);
    expect(groups[0].similarity).toBeGreaterThan(groups[1].similarity);
    expect(groups[0].crossSource).toBe(true);
    expect(groups[1].crossSource).toBe(false);
    expect(groups[0].telemetry).toEqual(['sysmon:1', 'windows-security:4688']);
    expect(groups[0].rules[0].closest?.pageId).toBe(groups[0].rules[1].pageId);
  });
});
