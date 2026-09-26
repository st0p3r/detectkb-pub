import { describe, expect, it } from 'vitest';
import { SIGMA_CATEGORY_TO_SYSMON, eventIdsFromSigma, eventIdsFromText } from '../src/lib/sysmon-links';

// Copied from the official table (product: windows, Sysmon channel) in
// sigma-specification/specification/sigma-appendix-taxonomy.md
const OFFICIAL_TAXONOMY: Record<string, number[]> = {
  process_creation: [1],
  file_change: [2],
  network_connection: [3],
  sysmon_status: [4, 16],
  process_termination: [5],
  driver_load: [6],
  image_load: [7],
  create_remote_thread: [8],
  raw_access_thread: [9],
  process_access: [10],
  file_event: [11],
  registry_event: [12, 13, 14],
  registry_add: [12],
  registry_delete: [12],
  registry_set: [13],
  registry_rename: [14],
  create_stream_hash: [15],
  pipe_created: [17, 18],
  wmi_event: [19, 20, 21],
  dns_query: [22],
  file_delete: [23],
  clipboard_capture: [24],
  process_tampering: [25],
  file_delete_detected: [26],
  file_block_executable: [27],
  file_block_shredding: [28],
  file_executable_detected: [29],
  sysmon_error: [255],
};

describe('Sigma category → Sysmon mapping', () => {
  it('matches the official Sigma taxonomy exactly', () => {
    expect(SIGMA_CATEGORY_TO_SYSMON).toEqual(OFFICIAL_TAXONOMY);
  });
});

describe('eventIdsFromText', () => {
  const ids = (t: string) => eventIdsFromText(t).sort((a, b) => a - b);

  it('ignores text that is not about Sysmon', () => {
    expect(ids('index=wineventlog EventCode=10')).toEqual([]);
  });

  it('reads SPL, KQL, EQL and prose forms', () => {
    expect(ids('`sysmon` EventCode=10 TargetImage=*lsass.exe')).toEqual([10]);
    expect(ids('index=sysmon EventCode IN (3, "22")')).toEqual([3, 22]);
    expect(ids('Sysmon | where EventID == 7')).toEqual([7]);
    expect(ids('logs-windows.sysmon_operational-* event.code in ("1", "3")')).toEqual([1, 3]);
    expect(ids('Data source: Sysmon EventID 10')).toEqual([10]);
    expect(ids('We collect Sysmon Event ID 22 (DNS)')).toEqual([22]);
  });

  it('does not split 4-digit Windows event IDs', () => {
    expect(ids('sysmon EventCode=4688')).toEqual([]);
    expect(ids('sysmon EventCode IN (4688, 1)')).toEqual([1]);
  });
});

describe('eventIdsFromSigma', () => {
  it('uses the logsource category for Windows rules', () => {
    expect(eventIdsFromSigma('title: t\nlogsource: {product: windows, category: process_access}\ndetection: {s: {a: 1}, condition: s}\n')).toEqual([10]);
  });

  it('reads EventID filters of service: sysmon rules', () => {
    const y = 'title: t\nlogsource: {product: windows, service: sysmon}\ndetection:\n  s:\n    EventID: [17, 18]\n  condition: s\n';
    expect(eventIdsFromSigma(y).sort()).toEqual([17, 18]);
  });

  it('does not link non-Windows categories', () => {
    expect(eventIdsFromSigma('title: t\nlogsource: {product: linux, category: process_creation}\ndetection: {s: {a: 1}, condition: s}\n')).toEqual([]);
  });
});
