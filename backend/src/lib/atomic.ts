import { Prisma } from '@prisma/client';
import { parse as parseYaml } from 'yaml';
import { prisma } from './prisma';
import { markDataChanged } from './kb-cache';
import { parentTechniqueId, resolveTechniqueId } from './attack';

// Atomic Red Team: small, scripted tests per ATT&CK technique
// (redcanaryco/atomic-red-team, atomics/<T>/<T>.yaml). DetectKB stores them as
// reference data and infers which telemetry running one should produce, so a
// technique's tests can be lined up with the rules expected to fire.
// DetectKB never runs them: that happens in a lab (Invoke-AtomicTest).

export const ATOMIC_REPO = 'https://github.com/redcanaryco/atomic-red-team';
export const ATOMIC_INDEX_URL = 'https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/Indexes/index.yaml';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());

export interface AtomicInput {
  name: string;
  description: string;
  type: string;
  default: string;
}

export interface AtomicDependency {
  description: string;
  prereqCommand: string;
  getPrereqCommand: string;
}

export interface ParsedAtomicTest {
  guid: string;
  techniqueId: string;
  testNumber: number;
  name: string;
  description: string | null;
  platforms: string[];
  executor: string;
  elevationRequired: boolean;
  command: string | null;
  cleanupCommand: string | null;
  inputArguments: AtomicInput[];
  dependencies: AtomicDependency[];
  dependencyExecutor: string | null;
}

function parseTest(t: unknown, techniqueId: string, testNumber: number): ParsedAtomicTest | null {
  if (!isObj(t)) return null;
  const guid = str(t.auto_generated_guid);
  const name = str(t.name);
  if (!guid || !name) return null;
  const executor = isObj(t.executor) ? t.executor : {};
  const inputs = isObj(t.input_arguments) ? t.input_arguments : {};
  return {
    guid: guid.slice(0, 64),
    techniqueId,
    testNumber,
    name: name.slice(0, 500),
    description: str(t.description) || null,
    platforms: (Array.isArray(t.supported_platforms) ? t.supported_platforms : []).map(str).filter(Boolean),
    executor: str(executor.name).slice(0, 40) || 'manual',
    elevationRequired: executor.elevation_required === true,
    // Manual tests describe steps instead of a command
    command: str(executor.command) || str(executor.steps) || null,
    cleanupCommand: str(executor.cleanup_command) || null,
    inputArguments: Object.entries(inputs).map(([key, v]) => ({
      name: key,
      description: isObj(v) ? str(v.description) : '',
      type: isObj(v) ? str(v.type) : '',
      default: isObj(v) ? str(v.default) : '',
    })),
    dependencies: (Array.isArray(t.dependencies) ? t.dependencies : []).filter(isObj).map((d) => ({
      description: str(d.description),
      prereqCommand: str(d.prereq_command),
      getPrereqCommand: str(d.get_prereq_command),
    })),
    dependencyExecutor: str(t.dependency_executor_name).slice(0, 40) || null,
  };
}

/** One technique file (atomics/T1003.001/T1003.001.yaml) → its tests. */
export function parseAtomicFile(content: string): ParsedAtomicTest[] {
  let doc: unknown;
  try {
    doc = parseYaml(content, { maxAliasCount: -1 });
  } catch {
    return [];
  }
  return parseTechniqueDoc(doc);
}

function parseTechniqueDoc(doc: unknown, fallbackId = ''): ParsedAtomicTest[] {
  if (!isObj(doc) || !Array.isArray(doc.atomic_tests)) return [];
  const techniqueId = (str(doc.attack_technique) || fallbackId).toUpperCase();
  if (!/^T\d{4}(\.\d{3})?$/.test(techniqueId)) return [];
  return doc.atomic_tests.map((t, i) => parseTest(t, techniqueId, i + 1)).filter((t): t is ParsedAtomicTest => !!t);
}

/**
 * The repository's index (atomics/Indexes/index.yaml: tactic → technique →
 * { technique, atomic_tests }). A technique under several tactics is listed
 * once per tactic; tests are kept once.
 */
export function parseAtomicIndex(content: string): ParsedAtomicTest[] {
  const doc = parseYaml(content, { maxAliasCount: -1 }) as unknown;
  if (!isObj(doc)) return [];
  const byGuid = new Map<string, ParsedAtomicTest>();
  for (const techniques of Object.values(doc)) {
    if (!isObj(techniques)) continue;
    for (const [id, entry] of Object.entries(techniques)) {
      for (const t of parseTechniqueDoc(entry, id)) if (!byGuid.has(t.guid)) byGuid.set(t.guid, t);
    }
  }
  return Array.from(byGuid.values());
}

/** A file is either a technique file or the whole index. */
export function parseAtomicContent(content: string): ParsedAtomicTest[] {
  const single = parseAtomicFile(content);
  if (single.length) return single;
  try {
    return parseAtomicIndex(content);
  } catch {
    return [];
  }
}

/** The command with #{input} placeholders replaced by their defaults. */
export function resolveInputs(command: string, inputs: AtomicInput[]): string {
  const defaults = new Map(inputs.map((i) => [i.name, i.default]));
  return command.replace(/#\{([\w-]+)\}/g, (m, name: string) => defaults.get(name) ?? m);
}

// ── Expected telemetry ──────────────────────────────────────────────────────
// Inferred from the platform, the executor and what the command does. Keys are
// the ones rules link to: "sysmon:N" (Sysmon for Windows) and log event keys.

interface TelemetryRule {
  pattern: RegExp;
  keys: string[];
  why: string;
}

const WINDOWS_RULES: TelemetryRule[] = [
  { pattern: /\breg(?:\.exe)?\s+(?:add|import|copy)\b|\b(?:New|Set)-ItemProperty\b|\bSetValue\(|\bNew-Item\b[^\n]*\bHK(?:LM|CU|U|CR):/i, keys: ['sysmon:12', 'sysmon:13'], why: 'registry write' },
  { pattern: /\breg(?:\.exe)?\s+delete\b|\bRemove-Item(?:Property)?\b[^\n]*\bHK(?:LM|CU|U|CR):/i, keys: ['sysmon:12'], why: 'registry delete' },
  { pattern: /\breg(?:\.exe)?\s+(?:save|export)\b/i, keys: ['sysmon:11'], why: 'registry hive saved to a file' },
  {
    pattern: /\b(?:Out-File|Set-Content|Add-Content|Export-\w+|Copy-Item|Move-Item|Expand-Archive|Compress-Archive)\b|\bNew-Item\b(?![^\n]*(?:-ItemType\s+Directory|\bHK(?:LM|CU|U|CR):))|\b(?:copy|xcopy|robocopy|move)\s|\s-OutFile\b|\bDownloadFile\(|\bcertutil\b[^\n]*-(?:urlcache|decode)|\bbitsadmin\b[^\n]*\/transfer|\bmakecab\b|\besentutl\b|(?<![0-9&])>>?\s*(?!\s*nul\b|&)["']?[\w$%.:\\/~-]/i,
    keys: ['sysmon:11'],
    why: 'file written',
  },
  { pattern: /\b(?:del|erase)\s|\bRemove-Item\b(?![^\n]*\bHK(?:LM|CU|U|CR):)|\bsdelete\b|\bcipher\s+\/w/i, keys: ['sysmon:23'], why: 'file deleted' },
  {
    pattern: /\b(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm|curl|wget|Start-BitsTransfer|bitsadmin|Test-NetConnection|Send-MailMessage)\b|Net\.WebClient|DownloadString|DownloadFile|\bcertutil\b[^\n]*-urlcache|\bNet\.Sockets\b|https?:\/\//i,
    keys: ['sysmon:3', 'sysmon:22'],
    why: 'network connection and DNS lookup',
  },
  { pattern: /\b(?:plink|ssh|scp|pscp|Enter-PSSession|New-PSSession)\b|\bInvoke-Command\b[^\n]*-ComputerName/i, keys: ['sysmon:3'], why: 'remote session' },
  { pattern: /\b(?:nslookup|Resolve-DnsName)\b/i, keys: ['sysmon:22'], why: 'DNS lookup' },
  { pattern: /\blsass\b/i, keys: ['sysmon:10'], why: 'access to the lsass process' },
  { pattern: /\b(?:rundll32|regsvr32|odbcconf|msiexec)\b|\bAdd-Type\b|\[Reflection\.Assembly\]::Load/i, keys: ['sysmon:7'], why: 'DLL or assembly loaded' },
  { pattern: /\bCreateRemoteThread\b|\bVirtualAllocEx\b|\bInject/i, keys: ['sysmon:8'], why: 'remote thread / injection' },
  { pattern: /\\\\\.\\pipe\\|\bNamedPipe/i, keys: ['sysmon:17', 'sysmon:18'], why: 'named pipe' },
  { pattern: /__EventFilter|CommandLineEventConsumer|ActiveScriptEventConsumer|__FilterToConsumerBinding/i, keys: ['sysmon:19', 'sysmon:20', 'sysmon:21'], why: 'WMI event subscription' },
  { pattern: /\bschtasks\b[^\n]*\/create|\bRegister-ScheduledTask\b|\bNew-ScheduledTask/i, keys: ['windows-security:4698'], why: 'scheduled task created' },
  { pattern: /\bsc(?:\.exe)?\s+(?:\\\\\S+\s+)?create\b|\bNew-Service\b|\bpsexec/i, keys: ['windows-system:7045', 'windows-security:4697'], why: 'service installed' },
  { pattern: /\bnet1?\s+user\b[^\n]*\/add|\bNew-LocalUser\b|\bNew-ADUser\b/i, keys: ['windows-security:4720'], why: 'user account created' },
  { pattern: /\bnet1?\s+localgroup\b[^\n]*\/add|\bAdd-LocalGroupMember\b/i, keys: ['windows-security:4732'], why: 'member added to a local group' },
  { pattern: /\bnet1?\s+group\b[^\n]*\/add|\bAdd-ADGroupMember\b/i, keys: ['windows-security:4728'], why: 'member added to a domain group' },
  { pattern: /\bwevtutil\b[^\n]*\bcl\b|\bClear-EventLog\b|\bwevtutil\b[^\n]*clear-log/i, keys: ['windows-security:1102', 'windows-system:104'], why: 'event log cleared' },
  { pattern: /\bauditpol\b/i, keys: ['windows-security:4719'], why: 'audit policy changed' },
  { pattern: /\bnetsh\b[^\n]*firewall[^\n]*\badd\b|\bNew-NetFirewallRule\b/i, keys: ['windows-security:4946'], why: 'firewall rule added' },
  { pattern: /\b(?:Set|Add)-MpPreference\b/i, keys: ['windows-defender:5007'], why: 'Defender configuration changed' },
  { pattern: /\bRubeus\b[^\n]*\basktgs\b|\bkerberoast|\bRequest-SPNTicket\b|KerberosRequestorSecurityToken/i, keys: ['windows-security:4769'], why: 'Kerberos service ticket requested' },
  { pattern: /\bRubeus\b[^\n]*\basktgt\b|\basreproast\b/i, keys: ['windows-security:4768'], why: 'Kerberos TGT requested' },
  { pattern: /\brunas\b|\bnet1?\s+use\b[^\n]*\/user:|-Credential\b/i, keys: ['windows-security:4648'], why: 'logon with explicit credentials' },
  { pattern: /\bnet1?\s+use\b|\bNew-SmbMapping\b|\\\\(?!\.\\|\?\\)[\w-][\w.-]*\\[\w$]+/i, keys: ['windows-security:5140'], why: 'network share accessed' },
];

const LINUX_RULES: TelemetryRule[] = [
  {
    pattern: /\b(?:touch|cp|mv|tee|dd|install|tar|zip|gzip|openssl\s+enc)\s|\b(?:curl|wget)\b[^\n]*\s-[oO]\b|(?<![0-9&])>>?\s*(?!\s*\/dev\/null)["']?[\w$~./-]/,
    keys: ['sysmon-linux:11'],
    why: 'file written',
  },
  { pattern: /\b(?:rm|shred|unlink)\s/, keys: ['sysmon-linux:23'], why: 'file deleted' },
  { pattern: /\b(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|ftp|telnet|socat)\b|\/dev\/tcp\//, keys: ['sysmon-linux:3'], why: 'network connection' },
];

export interface ExpectedTelemetry {
  key: string;
  /** Why DetectKB expects it */
  why: string;
}

/** Telemetry running the test should produce (always inferred, never certain). */
export function inferAtomicTelemetry(t: Pick<ParsedAtomicTest, 'platforms' | 'executor' | 'command' | 'inputArguments'>): ExpectedTelemetry[] {
  const out = new Map<string, string>();
  const add = (keys: string[], why: string) => keys.forEach((k) => !out.has(k) && out.set(k, why));
  const exec = t.executor.toLowerCase();
  if (exec === 'manual' || !t.command) return [];
  const command = resolveInputs(t.command, t.inputArguments);
  const windows = t.platforms.includes('windows') && (exec === 'powershell' || exec === 'command_prompt');
  const linux = t.platforms.includes('linux') && (exec === 'sh' || exec === 'bash');
  if (windows) {
    add(['sysmon:1', 'windows-security:4688'], 'process creation');
    if (exec === 'powershell') add(['windows-powershell:4104'], 'PowerShell script block');
    for (const r of WINDOWS_RULES) if (r.pattern.test(command)) add(r.keys, r.why);
  }
  if (linux) {
    add(['sysmon-linux:1', 'auditd:execve'], 'process creation');
    for (const r of LINUX_RULES) if (r.pattern.test(command)) add(r.keys, r.why);
  }
  return Array.from(out, ([key, why]) => ({ key, why }));
}

// ── Import ──────────────────────────────────────────────────────────────────

function toRow(t: ParsedAtomicTest, source: string) {
  return {
    techniqueId: t.techniqueId,
    testNumber: t.testNumber,
    name: t.name,
    description: t.description,
    platforms: t.platforms as Prisma.InputJsonValue,
    executor: t.executor,
    elevationRequired: t.elevationRequired,
    command: t.command,
    cleanupCommand: t.cleanupCommand,
    inputArguments: t.inputArguments as unknown as Prisma.InputJsonValue,
    dependencies: t.dependencies as unknown as Prisma.InputJsonValue,
    dependencyExecutor: t.dependencyExecutor,
    expectedTelemetry: inferAtomicTelemetry(t) as unknown as Prisma.InputJsonValue,
    source: source.slice(0, 500),
  };
}

/**
 * Saves tests (by GUID). Tests of the saved techniques that are missing from
 * the source were removed upstream and are deleted; with `replaceAll` (the
 * whole index) every test missing from it is.
 */
export async function saveAtomicTests(tests: ParsedAtomicTest[], source: string, opts: { replaceAll?: boolean } = {}) {
  const existing = new Set((await prisma.atomicTest.findMany({ select: { guid: true } })).map((t) => t.guid));
  let added = 0;
  let updated = 0;
  for (const t of tests) {
    const data = toRow(t, source);
    await prisma.atomicTest.upsert({ where: { guid: t.guid }, create: { guid: t.guid, ...data }, update: data });
    if (existing.has(t.guid)) updated++;
    else added++;
  }
  let removed = 0;
  const techniques = Array.from(new Set(tests.map((t) => t.techniqueId)));
  const keep = tests.map((t) => t.guid);
  // A technique file lists all of its tests: ones missing from it were removed upstream
  const where = opts.replaceAll ? { guid: { notIn: keep } } : { techniqueId: { in: techniques }, guid: { notIn: keep } };
  if (tests.length) removed = (await prisma.atomicTest.deleteMany({ where })).count;
  if (added || updated || removed) markDataChanged();
  return { added, updated, removed, techniques: techniques.length };
}

export async function importAtomicFiles(files: { name: string; content: string }[]) {
  const tests: ParsedAtomicTest[] = [];
  const skipped: string[] = [];
  let index = false;
  for (const f of files) {
    const single = parseAtomicFile(f.content);
    const parsed = single.length ? single : parseAtomicContent(f.content);
    if (!parsed.length) skipped.push(f.name);
    if (!single.length && parsed.length) index = true;
    tests.push(...parsed);
  }
  const unique = Array.from(new Map(tests.map((t) => [t.guid, t])).values());
  const result = await saveAtomicTests(unique, index ? 'upload: index.yaml' : `upload: ${files.length} file(s)`, { replaceAll: index });
  return { ...result, tests: unique.length, skipped };
}

/** Downloads the index from GitHub and replaces the stored tests with it. */
export async function fetchAtomicIndex() {
  const res = await fetch(ATOMIC_INDEX_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const tests = parseAtomicIndex(await res.text());
  if (!tests.length) throw new Error('The index contained no tests');
  return { ...(await saveAtomicTests(tests, ATOMIC_INDEX_URL, { replaceAll: true })), tests: tests.length };
}

// ── Tests ↔ rules ───────────────────────────────────────────────────────────

/** How a rule relates to a test of the same technique. */
export type AtomicRuleMatch =
  /** One of the rule's ways of being fed is fully in the test's expected telemetry */
  | 'telemetry'
  /** The rule reads an EDR/XDR product: fires if that product is deployed in the lab */
  | 'edr'
  /** Same technique, but the rule reads telemetry this test isn't expected to produce */
  | 'other-telemetry'
  /** Same technique, the rule has no telemetry links */
  | 'unknown';

const EDR_SOURCES = new Set(['crowdstrike', 'mde', 'elastic-defend', 'elastic-endgame', 'sentinelone', 'cisco-isovalent']);

export function matchRule(
  alternatives: string[][],
  expected: Set<string>,
  platforms: string[]
): AtomicRuleMatch {
  if (!alternatives.length) return 'unknown';
  if (alternatives.some((alt) => alt.every((k) => expected.has(k)))) return 'telemetry';
  const endpoint = platforms.some((p) => p === 'windows' || p === 'linux' || p === 'macos');
  if (endpoint && alternatives.some((alt) => alt.every((k) => EDR_SOURCES.has(k.slice(0, k.indexOf(':')))))) return 'edr';
  return 'other-telemetry';
}

/**
 * Does a rule tagged `ruleTechnique` target a test of `testTechnique`? Exact,
 * or the rule is tagged with the parent of the test's sub-technique. Not the
 * other way round: a test of T1003 doesn't exercise an LSASS (T1003.001) rule.
 */
export function techniqueRelation(ruleTechnique: string, testTechnique: string): 'exact' | 'parent' | null {
  const r = resolveTechniqueId(ruleTechnique) ?? ruleTechnique;
  const t = resolveTechniqueId(testTechnique) ?? testTechnique;
  if (r === t) return 'exact';
  if (!r.includes('.') && parentTechniqueId(t) === r) return 'parent';
  return null;
}
