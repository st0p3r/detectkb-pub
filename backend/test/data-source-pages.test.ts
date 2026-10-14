import { describe, expect, it } from 'vitest';
import { dataSourceContent } from '../src/lib/data-source-pages';
import { parseDataSourcePage } from '../src/lib/log-events';

describe('generated data source pages', () => {
  const content = dataSourceContent({
    label: 'CrowdStrike Falcon',
    platform: 'EDR',
    rules: 12,
    events: [
      { key: 'crowdstrike:processrollup2', label: 'CrowdStrike Falcon · ProcessRollup2', rules: 10 },
      { key: 'crowdstrike:dnsrequest', label: 'A | B', rules: 2 },
    ],
  });

  it('lists the events rules use and leaves collection details to fill', () => {
    expect(content).toContain('12 active rules read it');
    expect(content).toContain('| 10 | CrowdStrike Falcon · ProcessRollup2 |');
    expect(content).toContain('| 2 | A \\| B |');
    expect(content).toContain('## Collection');
  });

  it('names the whole source in the title, so impact analysis can pick it', () => {
    // Only the whole source: no event names read from the page text
    expect(parseDataSourcePage('CrowdStrike Falcon', content).map((e) => `${e.source}:${e.code}`)).toEqual(['crowdstrike:*']);
  });
});
