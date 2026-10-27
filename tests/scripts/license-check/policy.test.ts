import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkPolicy,
  declaredLicense,
  evaluatePackage,
  loadPolicy,
  matchesName,
} from '../../../scripts/license-check/policy.mjs';

const policyFile = fileURLToPath(new URL('../../../license-policy.json', import.meta.url));

const policy = checkPolicy({
  allowed: { shipped: ['MIT', 'ISC'], devOnly: ['CC0-1.0'] },
  allowedForPackages: [
    {
      license: 'MPL-2.0',
      packages: ['axe-core', '@axe-core/*'],
      devOnly: true,
      reason: 'accessibility tests',
    },
    { license: 'Zlib', packages: ['pako'], reason: 'fictional rule' },
  ],
  blockedLicenses: [
    { pattern: '^GPL', label: 'copyleft' },
    { pattern: 'Commons-?Clause', label: 'not open source' },
  ],
  blockedPackages: [{ name: '@paid-kit/*', reason: 'paid UI kit' }],
  exceptions: [
    { name: 'odd-meta', license: 'MIT', reason: 'LICENSE file says MIT' },
    { name: 'pinned', version: '1.0.0', license: 'ISC', reason: 'checked 1.0.0 by hand' },
  ],
});

const check = (
  license: unknown,
  scope: 'shipped' | 'dev' = 'shipped',
  name = 'some-package',
  version = '1.0.0',
) => evaluatePackage({ name, version, license }, scope, policy);

describe('matchesName', () => {
  it('treats "*" as any characters except "/"', () => {
    expect(matchesName('@paid-kit/*', '@paid-kit/grid')).toBe(true);
    expect(matchesName('@paid-kit/*', '@paid-kit')).toBe(false);
    expect(matchesName('grid-*', 'grid-pro')).toBe(true);
    expect(matchesName('grid-*', 'grid-pro/x')).toBe(false);
    expect(matchesName('a.b', 'aXb')).toBe(false);
    expect(matchesName('minio', 'minio-js')).toBe(false);
  });
});

describe('checkPolicy', () => {
  it('lists every shape problem at once', () => {
    expect(() =>
      checkPolicy({
        allowed: { shipped: 'MIT' },
        blockedLicenses: [{ pattern: '(', label: 'broken' }],
        allowedForPackages: [{ license: 'MPL-2.0', reason: 'x' }],
        exceptions: [{ name: 'x', license: 'MIT OR', reason: 'x', version: 1 }, 'text'],
        blockedPackages: {},
      }),
    ).toThrow(
      'license-policy.json: allowed.shipped must be a list of license identifiers; ' +
        'allowed.devOnly must be a list of license identifiers; ' +
        'allowedForPackages[0].packages must be a list of package names; ' +
        'blockedLicenses[0].pattern is not a valid regular expression; ' +
        'blockedPackages must be a list; ' +
        'exceptions[0].license is not a valid SPDX expression; ' +
        'exceptions[0].version must be an exact version; ' +
        'exceptions[1].name is required; exceptions[1].license is required; exceptions[1].reason is required',
    );
  });

  it('fills in missing optional lists', () => {
    expect(checkPolicy({ allowed: { shipped: [], devOnly: [] } })).toMatchObject({
      allowedForPackages: [],
      blockedLicenses: [],
      blockedPackages: [],
      exceptions: [],
    });
  });
});

describe('declaredLicense', () => {
  it('reads the license field and the legacy forms', () => {
    expect(declaredLicense({ license: ' MIT ' })).toBe('MIT');
    expect(declaredLicense({ license: { type: 'ISC', url: 'https://example.com' } })).toBe('ISC');
    expect(declaredLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      'MIT OR Apache-2.0',
    );
    expect(declaredLicense({ licenses: [{ type: 'MIT AND ISC' }, 'BSD-2-Clause'] })).toBe(
      '(MIT AND ISC) OR BSD-2-Clause',
    );
    expect(declaredLicense({ licenses: [{ type: 'MIT' }] })).toBe('MIT');
    expect(declaredLicense({ license: '' })).toBeNull();
    expect(declaredLicense({})).toBeNull();
  });
});

describe('evaluatePackage', () => {
  it('allows listed licenses in any case, and choices with one allowed option', () => {
    expect(check('MIT')).toEqual({ ok: true, license: 'MIT', problems: [], exception: null });
    expect(check('isc').ok).toBe(true);
    expect(check('(MIT OR GPL-3.0-only)').ok).toBe(true);
    expect(check('MIT AND ISC').ok).toBe(true);
  });

  it('explains each license that is not allowed', () => {
    expect(check('MIT AND Apache-2.0').problems).toEqual(['Apache-2.0 is not on the allowed list']);
    expect(check('GPL-3.0-only').problems).toEqual(['GPL-3.0-only is blocked (copyleft)']);
    expect(check('GPL-2.0+').problems).toEqual(['GPL-2.0+ is blocked (copyleft)']);
    expect(check('MIT WITH Commons-Clause').problems).toEqual([
      'MIT WITH Commons-Clause is blocked (not open source)',
    ]);
    expect(check('(GPL-2.0-only OR GPL-3.0-only) AND MIT').problems).toEqual([
      'GPL-2.0-only is blocked (copyleft)',
      'GPL-3.0-only is blocked (copyleft)',
    ]);
  });

  it('allows dev-only licenses only outside the shipped app', () => {
    expect(check('CC0-1.0', 'dev').ok).toBe(true);
    expect(check('CC0-1.0', 'shipped').problems).toEqual([
      'CC0-1.0 is allowed only in dev and test tools',
    ]);
  });

  it('allows package-specific licenses only for those packages', () => {
    expect(check('MPL-2.0', 'dev', 'axe-core').ok).toBe(true);
    expect(check('MPL-2.0', 'dev', '@axe-core/playwright').ok).toBe(true);
    expect(check('MPL-2.0', 'shipped', 'axe-core').problems).toEqual([
      'MPL-2.0 is allowed for axe-core only in dev and test tools',
    ]);
    expect(check('MPL-2.0', 'dev', 'other').problems).toEqual([
      'MPL-2.0 is allowed only for axe-core, @axe-core/*',
    ]);
    expect(check('Zlib', 'shipped', 'pako').ok).toBe(true);
  });

  it('reports missing, unlicensed, custom and invalid licenses', () => {
    expect(check(undefined).problems).toEqual(['no license is declared']);
    expect(check('UNLICENSED').problems).toEqual(['UNLICENSED: no license is granted']);
    expect(check('SEE LICENSE IN LICENSE.txt').problems).toEqual([
      'custom license terms ("SEE LICENSE IN LICENSE.txt")',
    ]);
    expect(check('Public Domain').problems).toEqual([
      '"Public Domain" is not a valid SPDX expression (unexpected "Domain")',
    ]);
  });

  it('blocks listed packages whatever their license says', () => {
    expect(check('MIT', 'dev', '@paid-kit/grid')).toEqual({
      ok: false,
      license: 'MIT',
      problems: ['the package is blocked: paid UI kit'],
      exception: null,
    });
  });

  it('uses an exception instead of the package metadata, for the listed version only', () => {
    const odd = check('SEE LICENSE IN README', 'shipped', 'odd-meta');
    expect(odd).toMatchObject({ ok: true, license: 'MIT', exception: { name: 'odd-meta' } });
    expect(check(undefined, 'shipped', 'pinned', '1.0.0').ok).toBe(true);
    expect(check(undefined, 'shipped', 'pinned', '1.0.1')).toMatchObject({
      ok: false,
      exception: null,
    });
  });
});

describe('license-policy.json', () => {
  const real = loadPolicy(policyFile);
  const judge = (license: string, scope: 'shipped' | 'dev', name = 'some-package') =>
    evaluatePackage({ name, version: '1.0.0', license }, scope, real).ok;

  it('follows decisions 0001, 0009 and 0011', () => {
    for (const license of [
      'MIT',
      'Apache-2.0',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'ISC',
      '0BSD',
      'BlueOak-1.0.0',
      'PostgreSQL',
      'Python-2.0',
      'Zlib',
      'Unicode-3.0',
      'Unicode-DFS-2016',
      'CC0-1.0',
    ]) {
      expect(judge(license, 'shipped')).toBe(true);
    }
    for (const license of ['CC-BY-4.0', 'MIT-0', 'Unlicense']) {
      expect(judge(license, 'dev')).toBe(true);
      expect(judge(license, 'shipped')).toBe(false);
    }
    for (const license of [
      'GPL-3.0-only',
      'LGPL-2.1-or-later',
      'AGPL-3.0-only',
      'SSPL-1.0',
      'BUSL-1.1',
      'Elastic-2.0',
    ]) {
      expect(judge(license, 'dev')).toBe(false);
    }
    expect(judge('MPL-2.0', 'dev', 'axe-core')).toBe(true);
    expect(judge('MPL-2.0', 'shipped', 'axe-core')).toBe(false);
    expect(judge('MPL-2.0', 'dev', 'some-package')).toBe(false);
    expect(judge('OFL-1.1', 'shipped', '@fontsource/inter')).toBe(true);
    expect(judge('OFL-1.1', 'shipped', '@fontsource-variable/inter')).toBe(true);
    expect(judge('OFL-1.1', 'dev', 'some-package')).toBe(false);
  });

  it('blocks paid kits by name', () => {
    for (const name of [
      'minio',
      '@tiptap-pro/extension-x',
      'highcharts',
      '@highcharts/dashboards',
      '@amcharts/amcharts5',
      'froala-editor',
      'ckeditor5-premium-features',
      'gojs',
      '@joint/plus',
      'dhtmlx-gantt',
      '@dhx/trial-suite',
      '@infragistics/igniteui-angular',
      'igniteui-react',
      '@nutrient-sdk/viewer',
      'pspdfkit',
      '@pdftron/webviewer',
      '@grapecity/wijmo',
      'mapbox-gl',
    ]) {
      expect(judge('MIT', 'dev', name)).toBe(false);
    }
    expect(judge('BSD-3-Clause', 'shipped', 'maplibre-gl')).toBe(true);
  });

  it('has no exceptions without a reason', () => {
    for (const exception of real.exceptions) expect(exception.reason.length).toBeGreaterThan(10);
  });
});
