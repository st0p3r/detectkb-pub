import { parse as parseYaml } from 'yaml';
import { parseSigmaDocuments } from './sigma';

// Telemetry other than Sysmon for Windows: Windows event logs, PowerShell,
// Sysmon for Linux, auditd, EDR events, cloud and SaaS logs. A log event is a
// (source, code) pair: "windows-security:4688", "crowdstrike:processrollup2",
// or "elastic-defend:*" when a rule only names the product.
// Sysmon for Windows keeps its own table (SysmonEvent); rules can depend on both.

export interface LogSourceInfo {
  label: string;
  platform: string;
}

/** Known sources; others are created on the fly (e.g. "windows-printservice"). */
export const LOG_SOURCES: Record<string, LogSourceInfo> = {
  'windows-security': { label: 'Windows Security', platform: 'Windows' },
  'windows-system': { label: 'Windows System', platform: 'Windows' },
  'windows-application': { label: 'Windows Application', platform: 'Windows' },
  'windows-powershell': { label: 'PowerShell', platform: 'Windows' },
  'windows-defender': { label: 'Microsoft Defender Antivirus', platform: 'Windows' },
  'windows-ntlm': { label: 'NTLM Operational', platform: 'Windows' },
  'windows-taskscheduler': { label: 'Windows Task Scheduler', platform: 'Windows' },
  'windows-iis': { label: 'IIS', platform: 'Windows' },
  'sysmon-linux': { label: 'Sysmon for Linux', platform: 'Linux' },
  auditd: { label: 'Linux auditd', platform: 'Linux' },
  'linux-syslog': { label: 'Linux syslog', platform: 'Linux' },
  osquery: { label: 'osquery', platform: 'Multi-platform' },
  crowdstrike: { label: 'CrowdStrike Falcon', platform: 'EDR' },
  mde: { label: 'Microsoft Defender XDR', platform: 'EDR' },
  mdi: { label: 'Microsoft Defender for Identity', platform: 'Identity' },
  mdo: { label: 'Microsoft Defender for Office 365', platform: 'SaaS' },
  mdca: { label: 'Microsoft Defender for Cloud Apps', platform: 'SaaS' },
  'elastic-defend': { label: 'Elastic Defend', platform: 'EDR' },
  'elastic-endgame': { label: 'Elastic Endgame', platform: 'EDR' },
  sentinelone: { label: 'SentinelOne', platform: 'EDR' },
  'cisco-isovalent': { label: 'Cisco Isovalent', platform: 'Linux' },
  'cisco-nvm': { label: 'Cisco Network Visibility Module', platform: 'Network' },
  'entra-id': { label: 'Microsoft Entra ID', platform: 'Identity' },
  'azure-activity': { label: 'Azure Activity', platform: 'Cloud' },
  'azure-diagnostics': { label: 'Azure Diagnostics', platform: 'Cloud' },
  m365: { label: 'Microsoft 365', platform: 'SaaS' },
  'aws-cloudtrail': { label: 'AWS CloudTrail', platform: 'Cloud' },
  'gcp-audit': { label: 'Google Cloud audit logs', platform: 'Cloud' },
  'google-workspace': { label: 'Google Workspace', platform: 'SaaS' },
  okta: { label: 'Okta', platform: 'Identity' },
  github: { label: 'GitHub', platform: 'SaaS' },
  kubernetes: { label: 'Kubernetes audit', platform: 'Containers' },
  zoom: { label: 'Zoom', platform: 'SaaS' },
  cef: { label: 'CEF (CommonSecurityLog)', platform: 'Network' },
  'security-alerts': { label: 'Security alerts', platform: 'Alerts' },
  'custom-log': { label: 'Custom log tables', platform: 'Other' },
  other: { label: 'Other', platform: 'Other' },
};

/** Names of well-known events, by source and code. */
const EVENT_NAMES: Record<string, Record<string, string>> = {
  'windows-security': {
    '1100': 'Event logging service shut down',
    '1102': 'Audit log cleared',
    '4624': 'Successful logon',
    '4625': 'Failed logon',
    '4627': 'Group membership information',
    '4634': 'Logoff',
    '4648': 'Logon with explicit credentials',
    '4656': 'Handle to an object requested',
    '4657': 'Registry value modified',
    '4662': 'Operation performed on an object',
    '4663': 'Attempt to access an object',
    '4672': 'Special privileges assigned to new logon',
    '4673': 'Privileged service called',
    '4688': 'Process creation',
    '4689': 'Process exit',
    '4697': 'Service installed',
    '4698': 'Scheduled task created',
    '4699': 'Scheduled task deleted',
    '4700': 'Scheduled task enabled',
    '4701': 'Scheduled task disabled',
    '4702': 'Scheduled task updated',
    '4703': 'Token right adjusted',
    '4719': 'System audit policy changed',
    '4720': 'User account created',
    '4722': 'User account enabled',
    '4723': 'Password change attempt',
    '4724': 'Password reset attempt',
    '4725': 'User account disabled',
    '4726': 'User account deleted',
    '4727': 'Security-enabled global group created',
    '4728': 'Member added to security-enabled global group',
    '4730': 'Security-enabled global group deleted',
    '4731': 'Security-enabled local group created',
    '4732': 'Member added to security-enabled local group',
    '4737': 'Security-enabled global group changed',
    '4738': 'User account changed',
    '4740': 'User account locked out',
    '4741': 'Computer account created',
    '4742': 'Computer account changed',
    '4744': 'Security-disabled local group created',
    '4749': 'Security-disabled global group created',
    '4754': 'Security-enabled universal group created',
    '4756': 'Member added to security-enabled universal group',
    '4759': 'Security-disabled universal group created',
    '4768': 'Kerberos TGT requested',
    '4769': 'Kerberos service ticket requested',
    '4771': 'Kerberos pre-authentication failed',
    '4776': 'Credential validation (NTLM)',
    '4781': 'Account name changed',
    '4794': 'DSRM administrator password set attempt',
    '4798': "User's local group membership enumerated",
    '4876': 'Certificate Services backup started',
    '4886': 'Certificate Services received a certificate request',
    '4887': 'Certificate Services approved a certificate request',
    '4946': 'Windows Firewall exception rule added',
    '4947': 'Windows Firewall exception rule modified',
    '4948': 'Windows Firewall exception rule deleted',
    '5136': 'Directory service object modified',
    '5137': 'Directory service object created',
    '5140': 'Network share object accessed',
    '5141': 'Directory service object deleted',
    '5145': 'Network share object checked for access',
    '5156': 'Windows Filtering Platform allowed a connection',
    '5441': 'Windows Filtering Platform filter present at startup',
    '5447': 'Windows Filtering Platform filter changed',
  },
  'windows-system': {
    '104': 'Event log cleared',
    '7036': 'Service state changed',
    '7040': 'Service start type changed',
    '7045': 'New service installed',
  },
  'windows-powershell': {
    '400': 'Engine started (classic)',
    '600': 'Provider started (classic)',
    '800': 'Pipeline execution (classic)',
    '4103': 'Module logging',
    '4104': 'Script block logging',
  },
  'windows-defender': {
    '1116': 'Malware detected',
    '1117': 'Action taken on malware',
    '1121': 'Attack surface reduction rule blocked',
    '1122': 'Attack surface reduction rule audited',
    '1125': 'Network protection audited',
    '1126': 'Network protection blocked',
    '1129': 'Controlled folder access audited',
    '1131': 'Blocked operation (ASR)',
    '1132': 'Audited operation (ASR)',
    '1133': 'Blocked operation',
    '1134': 'Audited operation',
    '5001': 'Real-time protection disabled',
    '5007': 'Configuration changed',
  },
  'windows-ntlm': {
    '8004': 'NTLM authentication to domain controller',
    '8005': 'NTLM authentication from client',
    '8006': 'NTLM authentication to server',
  },
  'sysmon-linux': {
    '1': 'Process creation',
    '3': 'Network connection',
    '5': 'Process terminated',
    '9': 'Raw access read',
    '11': 'File created',
    '16': 'Configuration change',
    '23': 'File delete',
  },
};

/**
 * Why a link exists: declared = named in the rule's own metadata (ESCU
 * data_source, Elastic tags, Sentinel tables, Sigma logsource service / EventID);
 * inferred = derived by DetectKB (EventID filters in the query, the Windows
 * audit equivalent of a Sigma category).
 */
export type LinkBasis = 'declared' | 'inferred';

export interface ParsedLogEvent {
  source: string;
  sourceLabel: string;
  /** Event ID or name; "*" = any event of the source */
  code: string;
  name: string;
  basis: LinkBasis;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const logEventKey = (e: { source: string; code: string }) => `${e.source}:${e.code === '*' ? '*' : slug(e.code) || e.code}`;

function event(source: string, code: string, name?: string, sourceLabel?: string, basis: LinkBasis = 'declared'): ParsedLogEvent {
  const label = LOG_SOURCES[source]?.label ?? sourceLabel ?? source;
  const known = EVENT_NAMES[source]?.[code];
  return {
    source,
    sourceLabel: label,
    code,
    name: code === '*' ? 'Any event' : known ?? name ?? (/^\d+$/.test(code) ? `Event ${code}` : code),
    basis,
  };
}
/** A Security event found in a query's EventID filter */
const inferredSecurity = (id: string) => event('windows-security', id, undefined, undefined, 'inferred');

// Windows event log channel (as ESCU writes it) → source
const CHANNEL_SOURCES: Record<string, string> = {
  security: 'windows-security',
  system: 'windows-system',
  application: 'windows-application',
  defender: 'windows-defender',
  powershell: 'windows-powershell',
  taskscheduler: 'windows-taskscheduler',
};

/** A Windows event log channel name → its source ("Printservice" → windows-printservice). */
function channelSource(rawChannel: string): { source: string; label: string } {
  // "Microsoft Windows TerminalServices RDPClient" → "TerminalServices RDPClient"
  const channel = rawChannel.replace(/^Microsoft[-\s]Windows[-\s]/i, '');
  const key = channel.toLowerCase().replace(/\s+/g, '');
  const known = CHANNEL_SOURCES[key];
  if (known) return { source: known, label: LOG_SOURCES[known].label };
  return { source: `windows-${slug(channel)}`, label: `Windows ${channel}` };
}

// "Vendor product event" prefixes (ESCU data source names) → source
const PREFIX_SOURCES: [RegExp, string][] = [
  [/^Sysmon for Linux EventID\s+(\d+)$/i, 'sysmon-linux'],
  [/^NTLM Operational\s+(\d+)$/i, 'windows-ntlm'],
  [/^Powershell (?:Script Block Logging|Module Logging)\s+(\d+)$/i, 'windows-powershell'],
  [/^CrowdStrike\s+(.+)$/i, 'crowdstrike'],
  [/^Linux Auditd\s+(.+)$/i, 'auditd'],
  [/^Linux\s+(Secure|Messages Syslog|Syslog)$/i, 'linux-syslog'],
  [/^Osquery\s+(.+)$/i, 'osquery'],
  [/^Cisco Isovalent\s+(.+)$/i, 'cisco-isovalent'],
  [/^Cisco Network Visibility Module\s+(.+)$/i, 'cisco-nvm'],
  [/^Windows IIS\s*(.*)$/i, 'windows-iis'],
  [/^(?:AWS CloudTrail|AWS)\s+(.+)$/i, 'aws-cloudtrail'],
  [/^(?:Azure Active Directory|Azure AD|Microsoft Entra ID)\s+(.+)$/i, 'entra-id'],
  [/^(?:O365|Office 365|Microsoft 365)\s+(.+)$/i, 'm365'],
  [/^Okta\s*(.*)$/i, 'okta'],
  [/^GitHub\s*(.*)$/i, 'github'],
  [/^Kubernetes\s*(.*)$/i, 'kubernetes'],
  [/^(?:Google Workspace|GSuite|G Suite)\s*(.*)$/i, 'google-workspace'],
  [/^(?:GCP|Google Cloud)\s*(.*)$/i, 'gcp-audit'],
];

/** "Sysmon EventID 1" — Sysmon for Windows, which has its own table. */
const isWindowsSysmon = (token: string) => /^sysmon(?!\s+for\s+linux)\b/i.test(token.trim());

/**
 * One data source name (ESCU style) → a log event, "sysmon" when it is Sysmon
 * for Windows (handled elsewhere), or null when it isn't recognised.
 * `fallback`: put unrecognised names under the "other" source instead of null.
 */
export function parseDataSourceName(raw: string, fallback = false): ParsedLogEvent | 'sysmon' | null {
  const token = raw.trim().replace(/…$/, '');
  if (!token) return null;
  if (isWindowsSysmon(token)) return 'sysmon';
  const win = token.match(/^Windows Event Log\s+(.+?)\s+(\d{1,5})$/i);
  if (win) {
    const { source, label } = channelSource(win[1]);
    return event(source, win[2], undefined, label);
  }
  for (const [re, source] of PREFIX_SOURCES) {
    const m = token.match(re);
    if (m) return event(source, (m[1] ?? '').trim() || '*', (m[1] ?? '').trim() || undefined);
  }
  return fallback ? event('other', token, token) : null;
}

// Product names used by Elastic's "Data Source:" tags → source
const PRODUCT_SOURCES: Record<string, string> = {
  'elastic defend': 'elastic-defend',
  'elastic endgame': 'elastic-endgame',
  sentinelone: 'sentinelone',
  'microsoft defender xdr': 'mde',
  'microsoft defender for endpoint': 'mde',
  crowdstrike: 'crowdstrike',
  'windows security event logs': 'windows-security',
  'active directory': 'windows-security',
  'powershell logs': 'windows-powershell',
  'windows application event logs': 'windows-application',
  'windows system event logs': 'windows-system',
  'auditd manager': 'auditd',
  auditd: 'auditd',
  'aws cloudtrail': 'aws-cloudtrail',
  aws: 'aws-cloudtrail',
  'microsoft entra id': 'entra-id',
  'azure active directory': 'entra-id',
  azure: 'azure-activity',
  'microsoft 365': 'm365',
  okta: 'okta',
  github: 'github',
  kubernetes: 'kubernetes',
  'google workspace': 'google-workspace',
  gcp: 'gcp-audit',
  zoom: 'zoom',
};

/** Product-level names (Elastic tags) → any event of that source. */
export function parseProductName(raw: string): ParsedLogEvent | 'sysmon' | null {
  const name = raw.trim().toLowerCase();
  if (!name) return null;
  if (name === 'sysmon') return 'sysmon';
  const source = PRODUCT_SOURCES[name];
  return source ? event(source, '*') : null;
}

// Microsoft Sentinel / Defender tables → source
function tableSource(table: string): string {
  if (/^Device|^Alert(Info|Evidence)$/.test(table)) return 'mde';
  if (/^Identity/.test(table)) return 'mdi';
  if (/^Email/.test(table)) return 'mdo';
  if (table === 'CloudAppEvents') return 'mdca';
  if (/^(SigninLogs|AADSignInEventsBeta|AADNonInteractiveUserSignInLogs|AuditLogs)$/.test(table)) return 'entra-id';
  if (table === 'AzureActivity') return 'azure-activity';
  if (table === 'AzureDiagnostics') return 'azure-diagnostics';
  if (table === 'OfficeActivity') return 'm365';
  if (table === 'AWSCloudTrail') return 'aws-cloudtrail';
  if (table === 'Syslog') return 'linux-syslog';
  if (table === 'CommonSecurityLog') return 'cef';
  if (table === 'SecurityAlert') return 'security-alerts';
  if (/_CL$/.test(table)) return 'custom-log';
  return 'other';
}

/** Windows Security event IDs a query filters on (SPL, KQL, EQL, ES|QL). */
export function securityEventIds(query: string): string[] {
  const ids = new Set<string>();
  const patterns = [
    /\b(?:EventCode|EventID|event\.code|winlog\.event_id)\s*(?:==|=~|=|:)\s*["']?(\d{4})\b/gi,
    /\b(?:EventCode|EventID|event\.code|winlog\.event_id)\s*(?:in~?|:)\s*\(([^)]*)\)/gi,
  ];
  for (const re of patterns) {
    for (const m of query.matchAll(re)) for (const n of m[1].match(/\b\d{4}\b/g) ?? []) if (+n >= 1100 && +n < 7000) ids.add(n);
  }
  return Array.from(ids);
}

/** Sentinel: the tables a rule reads, plus Security event IDs from its query. */
export function parseSentinelTables(tables: string[], query: string): ParsedLogEvent[] {
  const out: ParsedLogEvent[] = [];
  for (const raw of tables) {
    const table = raw.trim();
    if (!table) continue;
    if (/^(SecurityEvents?|WindowsEvent)$/.test(table)) {
      const ids = securityEventIds(query);
      if (ids.length) ids.forEach((id) => out.push(inferredSecurity(id)));
      else if (table !== 'WindowsEvent') out.push(event('windows-security', '*'));
      continue;
    }
    const source = tableSource(table);
    out.push(event(source, table, table));
  }
  return out;
}

// Sigma logsource → log events (besides the Sysmon events sysmon-links.ts derives)
const SIGMA_SERVICE_SOURCES: Record<string, string> = {
  security: 'windows-security',
  system: 'windows-system',
  application: 'windows-application',
  windefend: 'windows-defender',
  'taskscheduler': 'windows-taskscheduler',
  'ntlm': 'windows-ntlm',
  'powershell': 'windows-powershell',
  'powershell-classic': 'windows-powershell',
};
const SIGMA_CATEGORY_EVENTS: Record<string, [string, string][]> = {
  // Windows audit policy equivalents of Sysmon categories (pySigma windows audit pipeline)
  'windows/process_creation': [['windows-security', '4688']],
  'windows/ps_script': [['windows-powershell', '4104']],
  'windows/ps_module': [['windows-powershell', '4103']],
  'windows/ps_classic_start': [['windows-powershell', '400']],
  'windows/ps_classic_provider_start': [['windows-powershell', '600']],
  'windows/ps_classic_script': [['windows-powershell', '800']],
  'linux/process_creation': [
    ['sysmon-linux', '1'],
    ['auditd', 'execve'],
  ],
  'linux/network_connection': [['sysmon-linux', '3']],
  'linux/file_event': [['sysmon-linux', '11']],
  'linux/file_delete': [['sysmon-linux', '23']],
};
const SIGMA_PRODUCT_SOURCES: Record<string, string> = {
  aws: 'aws-cloudtrail',
  azure: 'azure-activity',
  m365: 'm365',
  okta: 'okta',
  github: 'github',
  gcp: 'gcp-audit',
  kubernetes: 'kubernetes',
  zeek: 'other',
};

export function parseSigmaLogsource(sigmaYaml: string): ParsedLogEvent[] {
  const out: ParsedLogEvent[] = [];
  for (const { doc } of parseSigmaDocuments(sigmaYaml)) {
    if (!doc) continue;
    const ls = (doc.logsource ?? {}) as Record<string, unknown>;
    const product = String(ls.product ?? '').toLowerCase();
    const service = String(ls.service ?? '').toLowerCase();
    const category = String(ls.category ?? '').toLowerCase();
    for (const [source, code] of SIGMA_CATEGORY_EVENTS[`${product}/${category}`] ?? []) out.push(event(source, code, undefined, undefined, 'inferred'));
    if (product === 'windows' && SIGMA_SERVICE_SOURCES[service]) {
      const source = SIGMA_SERVICE_SOURCES[service];
      const ids = new Set<string>();
      const detection = JSON.stringify(doc.detection ?? {});
      for (const m of detection.matchAll(/"EventID":\s*(\[[^\]]*\]|\d+)/g)) for (const n of m[1].match(/\d+/g) ?? []) ids.add(n);
      if (ids.size) ids.forEach((id) => out.push(event(source, id)));
      else out.push(event(source, '*'));
    } else if (product === 'linux' && service === 'auditd') {
      out.push(event('auditd', '*'));
    } else if (product === 'linux' && ['syslog', 'auth', 'sshd', 'sudo', 'cron'].includes(service)) {
      out.push(event('linux-syslog', service));
    } else if (SIGMA_PRODUCT_SOURCES[product] && product !== 'zeek') {
      out.push(event(SIGMA_PRODUCT_SOURCES[product], service || '*', service || undefined));
    }
  }
  return out;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** ESCU: the data_source list of the original YAML (the stored field may be cut short). */
function escuDataSources(content: string | null): string[] | null {
  if (!content) return null;
  try {
    const doc = parseYaml(content) as unknown;
    if (!isObj(doc)) return null;
    const list = doc.data_source;
    return Array.isArray(list) ? list.map(String) : null;
  } catch {
    return null;
  }
}

/** Elastic: "Data Source: X" tags of the original TOML (or the stored field). */
function elasticDataSources(content: string | null, stored: string | null): string[] {
  const tags = content ? Array.from(content.matchAll(/"Data Source:\s*([^"]+)"/g), (m) => m[1]) : [];
  return tags.length ? tags : (stored ?? '').split(/\s*,\s*/);
}

export interface RuleTelemetryInput {
  sourceFormat: string | null;
  dataSource: string | null;
  sourceContent?: string | null;
  sigmaYaml?: string | null;
  splQuery?: string | null;
  nativeQuery?: string | null;
}

export interface ParsedRuleTelemetry {
  events: ParsedLogEvent[];
  /** Data source names that weren't recognised (not Sysmon either) */
  unrecognised: string[];
  /**
   * Telemetry needed all at once ("Sysmon EventID 1 AND Sysmon EventID 11"), as
   * telemetry keys (sysmon:1, windows-security:4688); only groups of 2 or more
   */
  groups: string[][];
}

function dedupe(events: ParsedLogEvent[]): ParsedLogEvent[] {
  const byKey = new Map<string, ParsedLogEvent>();
  // Declared wins over inferred for the same event
  for (const e of events) {
    const prev = byKey.get(logEventKey(e));
    if (!prev || (prev.basis === 'inferred' && e.basis === 'declared')) byKey.set(logEventKey(e), e);
  }
  // A specific event of a source makes "any event" of the same source redundant
  const specific = new Set(Array.from(byKey.values()).filter((e) => e.code !== '*').map((e) => e.source));
  return Array.from(byKey.values()).filter((e) => e.code !== '*' || !specific.has(e.source));
}

/** The non-Sysmon telemetry a detection rule depends on. */
export function parseRuleTelemetry(r: RuleTelemetryInput): ParsedRuleTelemetry {
  const events: ParsedLogEvent[] = [];
  const unrecognised: string[] = [];
  const names = (list: string[], parse: (s: string) => ParsedLogEvent | 'sysmon' | null) => {
    for (const raw of list) {
      const name = raw.trim();
      if (!name) continue;
      const e = parse(name);
      if (e === null) unrecognised.push(name);
      else if (e !== 'sysmon') events.push(e);
    }
  };
  const query = `${r.splQuery ?? ''}\n${r.nativeQuery ?? ''}`;
  const groups: string[][] = [];
  // "A AND B" entries: both are needed; each part is also a link of its own
  const withGroups = (entries: string[], parse: (s: string) => ParsedLogEvent | 'sysmon' | null) => {
    for (const entry of entries) {
      const parts = entry.split(/\s+AND\s+/).map((p) => p.trim()).filter(Boolean);
      names(parts, parse);
      if (parts.length < 2) continue;
      const keys = parts.map((p) => {
        const sysmon = p.match(/^Sysmon EventID\s+(\d+)$/i);
        if (sysmon) return `sysmon:${sysmon[1]}`;
        const e = parse(p);
        return e && e !== 'sysmon' ? logEventKey(e) : null;
      });
      const unique = Array.from(new Set(keys.filter((k): k is string => !!k)));
      if (unique.length > 1 && !keys.includes(null)) groups.push(unique);
    }
  };

  if (r.sourceFormat === 'escu') {
    const list = escuDataSources(r.sourceContent ?? null) ?? (r.dataSource ?? '').split(/\s*,\s*/);
    withGroups(list, (s) => parseDataSourceName(s, true));
  } else if (r.sourceFormat === 'elastic') {
    names(elasticDataSources(r.sourceContent ?? null, r.dataSource), parseProductName);
    // "Windows Security Event Logs" + event.code filters → the specific events
    if (events.some((e) => e.source === 'windows-security')) securityEventIds(query).forEach((id) => events.push(inferredSecurity(id)));
  } else if (r.sourceFormat === 'sentinel') {
    events.push(...parseSentinelTables((r.dataSource ?? '').split(/\s*,\s*/), query));
  } else {
    if (r.sigmaYaml) events.push(...parseSigmaLogsource(r.sigmaYaml));
    // Hand-written data source field: "Windows Event Log Security 4688, Sysmon EventID 1"
    withGroups((r.dataSource ?? '').split(/\s*[,;\n]\s*/), (s) => parseDataSourceName(s) ?? parseProductName(s));
    if (/\bsecurity\b/i.test(r.dataSource ?? '') || /\bSecurityEvent\b|WinEventLog:Security/i.test(query))
      securityEventIds(query).forEach((id) => events.push(inferredSecurity(id)));
  }
  // Sigma logsource strings ("product:windows category:…") are handled by the Sysmon links
  return { events: dedupe(events), unrecognised: unrecognised.filter((s) => !/^(product|category|service):/i.test(s)), groups };
}

// Data source page titles naming a whole log ("Windows Security Event Log")
const PAGE_TITLE_SOURCES: [RegExp, string][] = [
  [/\bwindows security\b|\bsecurity (event )?log\b/i, 'windows-security'],
  [/\bpowershell\b/i, 'windows-powershell'],
  [/\bwindows system (event )?log\b/i, 'windows-system'],
  [/\bdefender antivirus\b/i, 'windows-defender'],
  [/\bauditd\b/i, 'auditd'],
];

/** A data source page: telemetry named in its title and text. */
export function parseDataSourcePage(title: string, content: string): ParsedLogEvent[] {
  const events: ParsedLogEvent[] = [];
  const whole = parseProductName(title) ?? parseDataSourceName(title);
  if (whole && whole !== 'sysmon') events.push(whole);
  else if (!/sysmon/i.test(title)) {
    const match = PAGE_TITLE_SOURCES.find(([re]) => re.test(title));
    if (match) events.push(event(match[1], '*'));
  }
  for (const line of `${title}\n${content}`.split(/\n|,|;/)) {
    const e = parseDataSourceName(line.replace(/^[\s*\-#>|`]+|[\s|`]+$/g, ''));
    if (e && e !== 'sysmon') events.push(e);
  }
  if (/windows security|security event log|security auditing/i.test(`${title}\n${content}`)) {
    for (const m of content.matchAll(/\bEvent\s?(?:ID|Code)?\s*:?\s*(\d{4})\b/gi)) {
      if (+m[1] >= 1100 && +m[1] < 7000) events.push(inferredSecurity(m[1]));
    }
  }
  return dedupe(events);
}
