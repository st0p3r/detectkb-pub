import { describe, expect, it } from 'vitest';
import { nativeQueryFields, ruleFieldRefs, sigmaDetectionFields, splFields } from '../src/lib/query-fields';

describe('fields a rule reads', () => {
  it('takes Sigma selection keys without modifiers', () => {
    const detection = {
      selection_img: { 'Image|endswith': '\\rundll32.exe', 'ParentCommandLine|contains|all': ['a', 'b'] },
      selection_alt: [{ OriginalFileName: 'RUNDLL32.EXE' }, { 'CommandLine|re': '.*' }],
      keywords: ['mimikatz', 'sekurlsa'],
      filter: { EventID: 1, User: 'SYSTEM' },
      condition: '1 of selection_* and not filter',
      timeframe: '5m',
    };
    expect(sigmaDetectionFields(detection)).toEqual(['Image', 'ParentCommandLine', 'OriginalFileName', 'CommandLine', 'User']);
    expect(sigmaDetectionFields(undefined)).toEqual([]);
  });

  it('finds the fields an SPL search filters on, not the ones it makes', () => {
    const spl = `index=win sourcetype="XmlWinEventLog:Sysmon" EventCode=10 TargetImage="*\\\\lsass.exe" GrantedAccess IN ("0x1010", "0x1410")
      | eval proc=lower(SourceImage)
      | where proc!="c:\\\\windows\\\\system32\\\\svchost.exe" AND like(CallTrace, "%dbghelp%")
      | stats count as hits by Computer, SourceImage
      | where hits > 3`;
    expect(splFields(spl)).toEqual(['TargetImage', 'GrantedAccess', 'SourceImage', 'CallTrace']);
  });

  it('reads tstats filters with their data model prefix', () => {
    const spl = '| tstats `security_content_summariesonly` count from datamodel=Endpoint.Processes where Processes.process_name=procdump.exe Processes.process="*-ma*" by Processes.dest Processes.user | `drop_dm_object_name(Processes)`';
    expect(splFields(spl)).toEqual(['Processes.process_name', 'Processes.process']);
  });

  it('finds the fields a KQL, EQL or Lucene query compares', () => {
    expect(nativeQueryFields('process where event.code == "1" and process.name : "procdump.exe" and process.args : "-ma"')).toEqual(['process.name', 'process.args']);
    expect(
      nativeQueryFields('SecurityEvent\n| where EventID == 4688 // process creation\n| where NewProcessName endswith "\\\\cmd.exe" and ParentProcessName has "winword"\n| extend Account = tolower(SubjectUserName)')
    ).toEqual(['NewProcessName', 'ParentProcessName']);
    expect(nativeQueryFields('event.action:"logon-failed" AND source.ip:10.0.0.0/8')).toEqual(['event.action', 'source.ip']);
    expect(nativeQueryFields(null)).toEqual([]);
  });

  it('never takes text inside strings for a field', () => {
    expect(splFields('index=a CommandLine="* user=admin pass=*"')).toEqual(['CommandLine']);
    expect(nativeQueryFields('where url == "http://x/?a=1&b:2"')).toEqual(['url']);
  });

  it('lists each field once, Sigma first', () => {
    const refs = ruleFieldRefs({
      sigmaYaml: 'title: t\nlogsource: {product: windows}\ndetection:\n  sel:\n    Image|endswith: x\n  condition: sel\n',
      splQuery: 'index=a image="x" CommandLine="y"',
      nativeQuery: null,
    });
    expect(refs).toEqual([
      { field: 'Image', source: 'sigma' },
      { field: 'CommandLine', source: 'spl' },
    ]);
  });
});
