import { describe, expect, it } from 'vitest';
import {
  SpdxSyntaxError,
  failingLicenses,
  formatSpdx,
  parseSpdx,
  satisfies,
} from '../../../scripts/license-check/spdx.mjs';

const license = (id: string, extra: { orLater?: boolean; exception?: string } = {}) => ({
  type: 'license',
  id,
  orLater: extra.orLater ?? false,
  exception: extra.exception ?? null,
});

describe('parseSpdx', () => {
  it('reads a single identifier, "+" and WITH', () => {
    expect(parseSpdx('MIT')).toEqual(license('MIT'));
    expect(parseSpdx('GPL-2.0+')).toEqual(license('GPL-2.0', { orLater: true }));
    expect(parseSpdx('GPL-2.0-only WITH Classpath-exception-2.0')).toEqual(
      license('GPL-2.0-only', { exception: 'Classpath-exception-2.0' }),
    );
    expect(parseSpdx('LicenseRef-Custom')).toEqual(license('LicenseRef-Custom'));
  });

  it('binds AND tighter than OR and flattens repeated operators', () => {
    expect(parseSpdx('MIT OR Apache-2.0 AND BSD-3-Clause OR ISC')).toEqual({
      type: 'or',
      items: [
        license('MIT'),
        { type: 'and', items: [license('Apache-2.0'), license('BSD-3-Clause')] },
        license('ISC'),
      ],
    });
    expect(parseSpdx('(MIT OR ISC) AND (0BSD)')).toEqual({
      type: 'and',
      items: [{ type: 'or', items: [license('MIT'), license('ISC')] }, license('0BSD')],
    });
    expect(parseSpdx('((MIT))')).toEqual(license('MIT'));
  });

  it('accepts operators in any case and extra spaces', () => {
    expect(formatSpdx(parseSpdx('  (mit or isc)and  bsd-2-clause '))).toBe(
      '(mit OR isc) AND bsd-2-clause',
    );
    expect(parseSpdx('Apache-2.0 with LLVM-exception')).toEqual(
      license('Apache-2.0', { exception: 'LLVM-exception' }),
    );
  });

  const invalid: [string, string][] = [
    ['', 'empty expression'],
    ['   ', 'empty expression'],
    ['MIT OR', 'the expression ends too early'],
    ['(MIT OR ISC', 'missing ")"'],
    ['MIT)', 'unexpected ")"'],
    ['MIT ISC', 'unexpected "ISC"'],
    ['AND MIT', 'unexpected "AND"'],
    ['MIT/X11', 'unexpected "MIT/X11"'],
    ['GPL-2.0 WITH', 'WITH needs an exception identifier'],
    ['GPL-2.0 WITH OR MIT', 'WITH needs an exception identifier'],
    ['Public Domain', 'unexpected "Domain"'],
  ];
  for (const [expression, reason] of invalid) {
    it(`rejects ${JSON.stringify(expression)}`, () => {
      let error: unknown;
      try {
        parseSpdx(expression);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(SpdxSyntaxError);
      expect((error as SpdxSyntaxError).reason).toBe(reason);
    });
  }
});

describe('satisfies and failingLicenses', () => {
  const allowed = new Set(['MIT', 'ISC']);
  const accept = (node: { id: string }) => allowed.has(node.id);

  it('needs one option of OR and every part of AND', () => {
    expect(satisfies(parseSpdx('MIT OR GPL-3.0-only'), accept)).toBe(true);
    expect(satisfies(parseSpdx('MIT AND GPL-3.0-only'), accept)).toBe(false);
    expect(satisfies(parseSpdx('(GPL-3.0-only OR ISC) AND MIT'), accept)).toBe(true);
  });

  it('names only the licenses that block the expression', () => {
    expect(failingLicenses(parseSpdx('MIT OR GPL-3.0-only'), accept)).toEqual([]);
    expect(failingLicenses(parseSpdx('MIT AND GPL-3.0-only'), accept)).toEqual([
      license('GPL-3.0-only'),
    ]);
    expect(failingLicenses(parseSpdx('MIT AND (GPL-3.0-only OR SSPL-1.0)'), accept)).toEqual([
      license('GPL-3.0-only'),
      license('SSPL-1.0'),
    ]);
  });
});

describe('formatSpdx', () => {
  it('writes parentheses only where they are needed', () => {
    const cases: [string, string][] = [
      ['MIT', 'MIT'],
      ['(MIT AND ISC) OR 0BSD', 'MIT AND ISC OR 0BSD'],
      ['(MIT OR ISC) AND 0BSD', '(MIT OR ISC) AND 0BSD'],
      ['GPL-2.0+ with Classpath-exception-2.0', 'GPL-2.0+ WITH Classpath-exception-2.0'],
    ];
    for (const [input, output] of cases) expect(formatSpdx(parseSpdx(input))).toBe(output);
  });
});
