import { describe, expect, it } from 'vitest';
import {
  logEventKey,
  parseDataSourceName,
  parseDataSourcePage,
  parseProductName,
  parseRuleTelemetry,
  parseSentinelTables,
  parseSigmaLogsource,
  securityEventIds,
} from '../src/lib/log-events';

const keys = (events: { source: string; code: string }[]) => events.map(logEventKey).sort();

describe('parseDataSourceName (ESCU names)', () => {
  it('reads Windows event log channels and event IDs', () => {
    expect(parseDataSourceName('Windows Event Log Security 4688')).toMatchObject({
      source: 'windows-security',
      code: '4688',
      name: 'Process creation',
      sourceLabel: 'Windows Security',
    });
    expect(parseDataSourceName('Windows Event Log System 7045')).toMatchObject({ source: 'windows-system', name: 'New service installed' });
    expect(parseDataSourceName('Windows Event Log Defender 1126')).toMatchObject({ source: 'windows-defender', code: '1126' });
    // Channels without an entry get their own source
    expect(parseDataSourceName('Windows Event Log Printservice 808')).toMatchObject({
      source: 'windows-printservice',
      sourceLabel: 'Windows Printservice',
      name: 'Event 808',
    });
  });

  it('reads vendor-prefixed names', () => {
    expect(parseDataSourceName('Powershell Script Block Logging 4104')).toMatchObject({ source: 'windows-powershell', code: '4104', name: 'Script block logging' });
    expect(parseDataSourceName('CrowdStrike ProcessRollup2')).toMatchObject({ source: 'crowdstrike', code: 'ProcessRollup2' });
    expect(parseDataSourceName('Sysmon for Linux EventID 1')).toMatchObject({ source: 'sysmon-linux', code: '1', name: 'Process creation' });
    expect(parseDataSourceName('Linux Auditd Execve')).toMatchObject({ source: 'auditd', code: 'Execve' });
    expect(parseDataSourceName('NTLM Operational 8004')).toMatchObject({ source: 'windows-ntlm', code: '8004' });
  });

  it('leaves Sysmon for Windows to its own table, and unknown names to the caller', () => {
    expect(parseDataSourceName('Sysmon EventID 1')).toBe('sysmon');
    expect(parseDataSourceName('Some Vendor Feed')).toBeNull();
    expect(parseDataSourceName('Some Vendor Feed', true)).toMatchObject({ source: 'other', code: 'Some Vendor Feed' });
    expect(logEventKey(parseDataSourceName('Some Vendor Feed', true) as never)).toBe('other:some-vendor-feed');
  });
});

describe('parseProductName (Elastic tags)', () => {
  it('maps products to any event of the source', () => {
    expect(parseProductName('Elastic Defend')).toMatchObject({ source: 'elastic-defend', code: '*', name: 'Any event' });
    expect(parseProductName('Windows Security Event Logs')).toMatchObject({ source: 'windows-security', code: '*' });
    expect(parseProductName('Sysmon')).toBe('sysmon');
    expect(parseProductName('Winlogbeat')).toBeNull();
  });
});

describe('securityEventIds / parseSentinelTables', () => {
  it('finds Security event IDs in queries', () => {
    expect(securityEventIds('SecurityEvent | where EventID == 4688')).toEqual(['4688']);
    expect(securityEventIds('SecurityEvent | where EventID in (4624, 4625)').sort()).toEqual(['4624', '4625']);
    expect(securityEventIds('event.code : "4769"')).toEqual(['4769']);
    // Sysmon IDs are not Security events
    expect(securityEventIds('EventCode=1')).toEqual([]);
  });

  it('maps tables to sources', () => {
    expect(keys(parseSentinelTables(['SecurityEvent'], 'SecurityEvent | where EventID == 4688'))).toEqual(['windows-security:4688']);
    expect(keys(parseSentinelTables(['SecurityEvent'], 'SecurityEvent | take 10'))).toEqual(['windows-security:*']);
    expect(keys(parseSentinelTables(['DeviceProcessEvents', 'SigninLogs', 'Foo_CL'], ''))).toEqual([
      'custom-log:foo-cl',
      'entra-id:signinlogs',
      'mde:deviceprocessevents',
    ]);
  });
});

describe('parseSigmaLogsource', () => {
  it('adds the Windows audit equivalent of Sysmon categories', () => {
    expect(keys(parseSigmaLogsource('logsource:\n  product: windows\n  category: process_creation\ndetection:\n  sel:\n    Image: x\n  condition: sel'))).toEqual([
      'windows-security:4688',
    ]);
    expect(keys(parseSigmaLogsource('logsource:\n  product: windows\n  category: ps_script\ndetection:\n  sel:\n    ScriptBlockText: x\n  condition: sel'))).toEqual([
      'windows-powershell:4104',
    ]);
  });

  it('reads EventID filters of Windows services', () => {
    const yaml = 'logsource:\n  product: windows\n  service: security\ndetection:\n  sel:\n    EventID:\n      - 4624\n      - 4625\n  condition: sel';
    expect(keys(parseSigmaLogsource(yaml))).toEqual(['windows-security:4624', 'windows-security:4625']);
    expect(keys(parseSigmaLogsource('logsource:\n  product: windows\n  service: system\ndetection:\n  sel:\n    Provider_Name: x\n  condition: sel'))).toEqual([
      'windows-system:*',
    ]);
  });

  it('maps Linux and cloud logsources', () => {
    expect(keys(parseSigmaLogsource('logsource:\n  product: linux\n  category: process_creation\ndetection:\n  sel:\n    Image: x\n  condition: sel'))).toEqual([
      'auditd:execve',
      'sysmon-linux:1',
    ]);
    expect(keys(parseSigmaLogsource('logsource:\n  product: aws\n  service: cloudtrail\ndetection:\n  sel:\n    eventName: x\n  condition: sel'))).toEqual([
      'aws-cloudtrail:cloudtrail',
    ]);
  });
});

describe('parseRuleTelemetry', () => {
  it('ESCU: reads data_source from the original YAML, splitting AND', () => {
    const content = 'name: x\ndata_source:\n  - Sysmon EventID 1 AND Windows Event Log Security 4688\n  - CrowdStrike ProcessRollup2\n  - Some Vendor Feed\nsearch: x';
    const r = parseRuleTelemetry({ sourceFormat: 'escu', dataSource: 'Sysmon EventID 1 AND Windows Event Log Se…', sourceContent: content });
    expect(keys(r.events)).toEqual(['crowdstrike:processrollup2', 'other:some-vendor-feed', 'windows-security:4688']);
    expect(r.unrecognised).toEqual([]);
  });

  it('Elastic: products, narrowed to Security events the query filters on', () => {
    const r = parseRuleTelemetry({
      sourceFormat: 'elastic',
      dataSource: null,
      sourceContent: 'tags = ["Data Source: Elastic Defend", "Data Source: Windows Security Event Logs", "Data Source: Sysmon", "Data Source: Winlogbeat"]',
      nativeQuery: 'event.code : "4769"',
    });
    // A specific Security event replaces "any Security event"
    expect(keys(r.events)).toEqual(['elastic-defend:*', 'windows-security:4769']);
    expect(r.unrecognised).toEqual(['Winlogbeat']);
  });

  it('hand-written rules: the data source field and the query', () => {
    const r = parseRuleTelemetry({
      sourceFormat: null,
      dataSource: 'Windows Event Log Security 4624; Sysmon EventID 1; my custom feed',
      splQuery: 'index=wineventlog EventCode=4625',
    });
    expect(keys(r.events)).toEqual(['windows-security:4624', 'windows-security:4625']);
    expect(r.unrecognised).toEqual(['my custom feed']);
  });
});

describe('parseDataSourcePage', () => {
  it('reads products and Security events named on a data source page', () => {
    expect(keys(parseDataSourcePage('Elastic Defend', 'Endpoint telemetry'))).toEqual(['elastic-defend:*']);
    expect(keys(parseDataSourcePage('Windows Security Event Log', 'Collect Event ID 4624 and EventID 4688.'))).toEqual([
      'windows-security:4624',
      'windows-security:4688',
    ]);
  });
});
