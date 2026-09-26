import { prisma } from './prisma';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';


const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    'users:create', 'users:read', 'users:update', 'users:delete', 'users:assign_roles',
    'pages:create', 'pages:read', 'pages:update', 'pages:delete',
    'rules:create', 'rules:read', 'rules:update', 'rules:delete',
    'tags:create', 'tags:read', 'tags:update', 'tags:delete',
    'backups:create', 'backups:delete', 'backups:restore',
    'docs:create', 'docs:read', 'docs:delete',
    'audit:read', 'settings:manage',
  ],
  editor: [
    'pages:create', 'pages:read', 'pages:update', 'pages:delete',
    'rules:create', 'rules:read', 'rules:update', 'rules:delete',
    'tags:create', 'tags:read', 'tags:update',
    'backups:create',
    'docs:create', 'docs:read',
  ],
  viewer: [
    'pages:read',
    'rules:read',
    'tags:read',
    'docs:read',
  ],
};

// Built-in Sysmon event reference (validated by test/seed-data.test.ts)
export const SYSMON_EVENTS = [
  { eventId: 1, name: 'Process Creation', category: 'Process', detectionValue: 'high', description: 'Logs the creation of new processes with full command line, hashes, parent process, and user context.', keyFields: 'ProcessGuid, ProcessId, Image, FileVersion, Description, Product, Company, OriginalFileName, CommandLine, CurrentDirectory, User, LogonGuid, LogonId, TerminalSessionId, IntegrityLevel, Hashes, ParentProcessGuid, ParentProcessId, ParentImage, ParentCommandLine', detectionTips: 'Look for unusual parent-child process relationships, suspicious command-line arguments, LOLBins (living-off-the-land binaries), processes spawned from Office applications or browsers.', attackPatterns: 'T1059 (Scripting), T1036 (Masquerading), T1055 (Process Injection), T1204 (User Execution)' },
  { eventId: 2, name: 'File Creation Time Changed', category: 'File', detectionValue: 'medium', description: 'Detects when a process changes the creation time of a file — a timestomping technique used to hide malicious files.', keyFields: 'ProcessGuid, ProcessId, Image, TargetFilename, CreationUtcTime, PreviousCreationUtcTime, User', detectionTips: 'Any modification to file creation timestamps is suspicious, especially by non-system processes. Correlate with process creation events.', attackPatterns: 'T1070.006 (Timestomp)' },
  { eventId: 3, name: 'Network Connection', category: 'Network', detectionValue: 'high', description: 'Records TCP/UDP network connections including source/destination IPs, ports, and the initiating process.', keyFields: 'ProcessGuid, ProcessId, Image, User, Protocol, Initiated, SourceIsIpv6, SourceIp, SourceHostname, SourcePort, SourcePortName, DestinationIsIpv6, DestinationIp, DestinationHostname, DestinationPort, DestinationPortName', detectionTips: 'Look for unusual processes making outbound connections, connections to rare external IPs, beaconing patterns, high-frequency connections, and connections on unusual ports.', attackPatterns: 'T1071 (Application Layer Protocol), T1095 (Non-Application Layer Protocol), T1041 (Exfiltration Over C2 Channel)' },
  { eventId: 4, name: 'Sysmon Service State Changed', category: 'Service', detectionValue: 'low', description: 'Reports when the Sysmon service itself starts or stops. Useful for detecting tampering with Sysmon.', keyFields: 'State, Version, SchemaVersion', detectionTips: 'Alert on Sysmon service stopping unexpectedly — may indicate an attacker attempting to disable logging.', attackPatterns: 'T1685 (Disable or Modify Tools)' },
  { eventId: 5, name: 'Process Terminated', category: 'Process', detectionValue: 'medium', description: 'Logs when a process exits. Useful for correlating with process creation events to track process lifetime.', keyFields: 'ProcessGuid, ProcessId, Image, User', detectionTips: 'Correlate with Event ID 1 to calculate process lifetime. Very short-lived processes can indicate execution of malicious scripts or tools.', attackPatterns: 'T1059 (Command and Scripting Interpreter)' },
  { eventId: 6, name: 'Driver Loaded', category: 'Driver', detectionValue: 'high', description: 'Records driver load events with image path and hashes. Critical for detecting rootkits and unsigned driver loading.', keyFields: 'ImageLoaded, Hashes, Signed, Signature, SignatureStatus', detectionTips: 'Alert on unsigned drivers, drivers from unusual paths, or drivers with invalid signatures. Rootkits often load as drivers.', attackPatterns: 'T1014 (Rootkit), T1543.003 (Windows Service), T1547.006 (Kernel Modules and Extensions)' },
  { eventId: 7, name: 'Image Loaded', category: 'Image', detectionValue: 'high', description: 'Logs DLL and module loads into processes. Very noisy but valuable for detecting DLL injection and side-loading.', keyFields: 'ProcessGuid, ProcessId, Image, ImageLoaded, FileVersion, Description, Product, Company, OriginalFileName, Hashes, Signed, Signature, SignatureStatus, User', detectionTips: 'Look for unsigned DLLs loaded by legitimate processes, DLLs loaded from temp directories, or known malicious DLL names.', attackPatterns: 'T1055.001 (Dynamic-link Library Injection), T1574.001 (DLL search order hijacking / side-loading)' },
  { eventId: 8, name: 'CreateRemoteThread', category: 'Process', detectionValue: 'high', description: 'Detects when a process creates a thread in another process — a classic code injection technique.', keyFields: 'SourceProcessGuid, SourceProcessId, SourceImage, TargetProcessGuid, TargetProcessId, TargetImage, NewThreadId, StartAddress, StartModule, StartFunction', detectionTips: 'Almost any legitimate remote thread creation is suspicious. Look for unknown source modules and NULL start modules.', attackPatterns: 'T1055.003 (Thread Execution Hijacking), T1055 (Process Injection)' },
  { eventId: 9, name: 'RawAccessRead', category: 'Storage', detectionValue: 'medium', description: 'Detects raw disk read operations, often used by credential theft tools reading the NTDS.dit or SAM database.', keyFields: 'ProcessGuid, ProcessId, Image, Device, User', detectionTips: 'Look for unusual processes accessing raw disk devices. Mimikatz and credential dumpers often use raw disk access.', attackPatterns: 'T1003.003 (NTDS), T1003.002 (Security Account Manager)' },
  { eventId: 10, name: 'Process Access', category: 'Process', detectionValue: 'high', description: 'Logs when one process opens a handle to another — key indicator for credential dumping (LSASS access).', keyFields: 'SourceProcessGUID, SourceProcessId, SourceThreadId, SourceImage, TargetProcessGUID, TargetProcessId, TargetImage, GrantedAccess, CallTrace', detectionTips: 'Alert on any process opening LSASS with read permissions. CallTrace showing unknown modules is highly suspicious.', attackPatterns: 'T1003.001 (LSASS Memory), T1055 (Process Injection)' },
  { eventId: 11, name: 'FileCreate', category: 'File', detectionValue: 'medium', description: 'Logs file creation and overwrite events with the creating process and file hashes.', keyFields: 'ProcessGuid, ProcessId, Image, TargetFilename, CreationUtcTime, Hash, User', detectionTips: 'Monitor temp directories, startup folders, and sensitive paths. Look for executables created by unusual parents like Office or browser processes.', attackPatterns: 'T1105 (Ingress Tool Transfer), T1204 (User Execution), T1547.001 (Registry Run Keys / Startup Folder)' },
  { eventId: 12, name: 'Registry Object Created/Deleted', category: 'Registry', detectionValue: 'medium', description: 'Logs registry key and value creation and deletion events.', keyFields: 'EventType, ProcessGuid, ProcessId, Image, User, TargetObject', detectionTips: 'Monitor persistence locations (Run keys, Services, etc.). Look for registry keys created in suspicious paths by unusual processes.', attackPatterns: 'T1547.001 (Registry Run Keys), T1112 (Modify Registry)' },
  { eventId: 13, name: 'Registry Value Set', category: 'Registry', detectionValue: 'high', description: 'Logs when registry values are set. Captures the new value data — very useful for persistence detection.', keyFields: 'EventType, ProcessGuid, ProcessId, Image, User, TargetObject, Details', detectionTips: 'Monitor common persistence registry keys for new values. The Details field shows the actual value set.', attackPatterns: 'T1547.001 (Registry Run Keys), T1112 (Modify Registry), T1574 (Hijack Execution Flow)' },
  { eventId: 14, name: 'Registry Key/Value Renamed', category: 'Registry', detectionValue: 'medium', description: 'Logs registry key and value rename operations.', keyFields: 'EventType, ProcessGuid, ProcessId, Image, User, TargetObject, NewName', detectionTips: 'Renaming registry keys can be used to evade detection rules that monitor specific key names.', attackPatterns: 'T1112 (Modify Registry), T1036 (Masquerading)' },
  { eventId: 15, name: 'FileCreateStreamHash', category: 'File', detectionValue: 'high', description: 'Logs creation of alternate data streams (ADS) — commonly used to hide malicious content in NTFS.', keyFields: 'ProcessGuid, ProcessId, Image, TargetFilename, CreationUtcTime, Hash, Contents, User', detectionTips: 'Any ADS creation by a non-browser process is suspicious. Browser downloads use Zone.Identifier ADS; others are rare.', attackPatterns: 'T1564.004 (NTFS File Attributes), T1027 (Obfuscated Files or Information)' },
  { eventId: 16, name: 'ServiceConfigurationChange', category: 'Service', detectionValue: 'medium', description: 'Logs changes to the Sysmon service configuration when a new configuration is applied.', keyFields: 'UtcTime, Configuration, ConfigurationFileHash', detectionTips: 'Unexpected Sysmon config changes may indicate an attacker modifying logging to evade detection.', attackPatterns: 'T1685 (Disable or Modify Tools)' },
  { eventId: 17, name: 'Pipe Created', category: 'Pipe', detectionValue: 'high', description: 'Logs named pipe creation events. Many C2 frameworks and lateral movement tools use named pipes.', keyFields: 'ProcessGuid, ProcessId, PipeName, Image, User', detectionTips: 'Look for known malicious pipe names (e.g., \\\\pipe\\\\psexec, Cobalt Strike pipe names). Unusual pipe names from system32 processes are suspicious.', attackPatterns: 'T1021.002 (SMB/Windows Admin Shares), T1559.001 (Component Object Model)' },
  { eventId: 18, name: 'Pipe Connected', category: 'Pipe', detectionValue: 'medium', description: 'Logs when a process connects to a named pipe.', keyFields: 'ProcessGuid, ProcessId, PipeName, Image, User', detectionTips: 'Correlate with Event ID 17. Unexpected connections to administrative pipes from unusual processes indicate lateral movement.', attackPatterns: 'T1021.002 (SMB/Windows Admin Shares)' },
  { eventId: 19, name: 'WMI EventFilter Activity', category: 'WMI', detectionValue: 'high', description: 'Logs WMI EventFilter creation — the trigger component of WMI subscriptions used for persistence.', keyFields: 'EventType, Operation, User, EventNamespace, Name, Query', detectionTips: 'WMI subscriptions are a stealthy persistence mechanism. Any new WMI EventFilter should be investigated.', attackPatterns: 'T1546.003 (Windows Management Instrumentation Event Subscription)' },
  { eventId: 20, name: 'WMI EventConsumer Activity', category: 'WMI', detectionValue: 'high', description: 'Logs WMI EventConsumer creation — the action component of WMI subscriptions.', keyFields: 'EventType, Operation, User, Name, Type, Destination', detectionTips: 'The Destination field reveals what command will be executed. CommandLineEventConsumer executing scripts is a major red flag.', attackPatterns: 'T1546.003 (Windows Management Instrumentation Event Subscription)' },
  { eventId: 21, name: 'WMI ConsumerToFilter Binding', category: 'WMI', detectionValue: 'high', description: 'Logs WMI ConsumerToFilter binding — the final step that activates a WMI subscription.', keyFields: 'EventType, Operation, User, Consumer, Filter', detectionTips: 'This event finalizes the WMI persistence mechanism. Alert on any new ConsumerToFilter binding.', attackPatterns: 'T1546.003 (Windows Management Instrumentation Event Subscription)' },
  { eventId: 22, name: 'DNS Query', category: 'Network', detectionValue: 'high', description: 'Logs DNS queries made by processes. Essential for detecting DNS-based C2 and DGA domains.', keyFields: 'ProcessGuid, ProcessId, QueryName, QueryStatus, QueryResults, Image, User', detectionTips: 'Look for high-entropy domain names (DGA), queries to recently registered domains, DNS-based C2 beaconing, and queries from unusual processes.', attackPatterns: 'T1071.004 (DNS), T1568.002 (Domain Generation Algorithms)' },
  { eventId: 23, name: 'File Delete Archived', category: 'File', detectionValue: 'medium', description: 'Logs file deletion events and archives the deleted file (if configured). Useful for malware cleanup detection.', keyFields: 'ProcessGuid, ProcessId, User, Image, TargetFilename, Hashes, IsExecutable, Archived', detectionTips: 'Malware often deletes itself after execution. Archive feature allows recovery of deleted malicious files for analysis.', attackPatterns: 'T1070.004 (File Deletion), T1036 (Masquerading)' },
  { eventId: 24, name: 'Clipboard Change', category: 'Process', detectionValue: 'medium', description: 'Logs when the clipboard content changes and captures a hash or content (if configured). Detects clipboard hijacking.', keyFields: 'ProcessGuid, ProcessId, Image, Session, ClientInfo, Hashes, Archived, User', detectionTips: 'Clipboard hijacking malware replaces cryptocurrency addresses. Look for unusual processes capturing clipboard data.', attackPatterns: 'T1115 (Clipboard Data)' },
  { eventId: 25, name: 'Process Tampering', category: 'Process', detectionValue: 'high', description: 'Detects process hollowing and herpaderping — techniques that replace process memory with malicious code.', keyFields: 'ProcessGuid, ProcessId, Image, Type, User', detectionTips: 'Process hollowing and herpaderping are advanced evasion techniques. Any detection should be treated as high severity.', attackPatterns: 'T1055.012 (Process Hollowing), T1055.013 (Process Doppelgänging)' },
  { eventId: 26, name: 'File Delete Detected', category: 'File', detectionValue: 'low', description: 'Logs file deletion events without archiving the file. Lower overhead than Event ID 23.', keyFields: 'ProcessGuid, ProcessId, User, Image, TargetFilename, Hashes, IsExecutable', detectionTips: 'Use alongside Event ID 23 or as a lower-overhead alternative for high-volume environments.', attackPatterns: 'T1070.004 (File Deletion)' },
  { eventId: 27, name: 'File Block Executable', category: 'File', detectionValue: 'high', description: 'Logs when an executable file write is blocked by Sysmon (requires FileBlockExecutable rule configuration).', keyFields: 'ProcessGuid, ProcessId, User, Image, TargetFilename, Hashes', detectionTips: 'This event only fires when Sysmon is configured to block executables. Indicates an active prevention action.', attackPatterns: 'T1105 (Ingress Tool Transfer)' },
  { eventId: 28, name: 'File Block Shredding', category: 'File', detectionValue: 'medium', description: 'Logs when a file shred/secure delete is blocked by Sysmon (requires FileBlockShredding rule configuration).', keyFields: 'ProcessGuid, ProcessId, User, Image, TargetFilename, Hashes, IsExecutable', detectionTips: 'Blocking file shredding can prevent evidence destruction by malware attempting to cover its tracks.', attackPatterns: 'T1485 (Data Destruction), T1070 (Indicator Removal)' },
  { eventId: 29, name: 'File Executable Detected', category: 'File', detectionValue: 'medium', description: 'Logs when an executable file is detected being written to disk (requires FileExecutableDetected configuration).', keyFields: 'ProcessGuid, ProcessId, User, Image, TargetFilename, Hashes', detectionTips: 'Useful for tracking when executables are dropped to disk without necessarily blocking them.', attackPatterns: 'T1105 (Ingress Tool Transfer), T1204.002 (Malicious File)' },
];

export async function seedDatabase() {
  // Seed permissions
  const allPerms = Array.from(new Set(Object.values(ROLE_PERMISSIONS).flat()));
  for (const name of allPerms) {
    const category = name.split(':')[0];
    await prisma.permission.upsert({
      where: { name },
      create: { name, category },
      update: {},
    });
  }

  // Seed roles and wire permissions
  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      create: { name: roleName, isSystemRole: true },
      update: {},
    });

    for (const permName of permNames) {
      const perm = await prisma.permission.findUnique({ where: { name: permName } });
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: { roleId: role.id, permissionId: perm.id },
        update: {},
      });
    }
  }

  // Seed admin user from env vars or config.json if no users exist
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@detectkb.local';

    // Try to load persisted hash from config.json (from old single-user system)
    let passwordHash: string | null = null;
    let usesDefaultPassword = false;
    const configPath = path.join(process.cwd(), 'data', 'config.json');
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (cfg.passwordHash) passwordHash = cfg.passwordHash;
    } catch {
      // no config file
    }

    if (!passwordHash) {
      if (process.env.ADMIN_PASSWORD_HASH) {
        passwordHash = process.env.ADMIN_PASSWORD_HASH;
      } else {
        const plain = process.env.ADMIN_PASSWORD || 'detectkb';
        usesDefaultPassword = plain === 'detectkb';
        passwordHash = await bcrypt.hash(plain, 10);
      }
    }

    const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
    const admin = await prisma.user.create({
      data: {
        username: adminUsername,
        email: adminEmail,
        passwordHash,
        isActive: true,
        // The well-known default password must be replaced on first login
        mustChangePassword: usesDefaultPassword,
      },
    });

    if (adminRole) {
      await prisma.userRole.create({ data: { userId: admin.id, roleId: adminRole.id } });
    }

    console.log(`[seed] Created admin user "${adminUsername}"`);
  }

  // Seed built-in page type definitions
  const BUILT_IN_TYPES = [
    { name: 'NOTE', label: 'Note', color: '#64748b' },
    { name: 'CONCEPT', label: 'Concept', color: '#7c3aed' },
    { name: 'DATA_SOURCE', label: 'Data Source', color: '#0891b2' },
    { name: 'RULE', label: 'Rule', color: '#4338ca' },
    { name: 'SPL_COMMAND', label: 'SPL Command', color: '#d97706' },
  ];

  for (const t of BUILT_IN_TYPES) {
    await prisma.pageTypeDefinition.upsert({
      where: { name: t.name },
      create: { name: t.name, label: t.label, color: t.color, isBuiltIn: true },
      update: { label: t.label, color: t.color, isBuiltIn: true },
    });
  }

  // Seed Sysmon event IDs

  for (const e of SYSMON_EVENTS) {
    await prisma.sysmonEvent.upsert({
      where: { eventId: e.eventId },
      create: e,
      update: { name: e.name, category: e.category, description: e.description, keyFields: e.keyFields, detectionTips: e.detectionTips, attackPatterns: e.attackPatterns, detectionValue: e.detectionValue, isBuiltIn: true },
    });
  }
}
