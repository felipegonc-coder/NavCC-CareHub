import { describe, expect, it } from 'vitest';
import {
  CERTIFICATE_ALPHABET,
  CERTIFICATE_CODE_RANDOM_BYTES,
  certificateExpiry,
  certificateStatus,
  createCertificateCode,
  isCertificateCodeWellFormed,
  normalizeCertificateCode,
} from './index';

const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Deterministic test bytes (xorshift32), so failures are reproducible. */
function bytes(seed: number, count = CERTIFICATE_CODE_RANDOM_BYTES): Uint8Array {
  let x = seed >>> 0 || 1;
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

const codes = Array.from({ length: 120 }, (_, i) => createCertificateCode(bytes(i + 1)));
const symbolsOf = (code: string): string => code.replaceAll('-', '');
const asCode = (symbols: string): string =>
  `${symbols.slice(0, 4)}-${symbols.slice(4, 8)}-${symbols.slice(8)}`;

describe('createCertificateCode', () => {
  it('makes XXXX-XXXX-XXXX codes from Crockford base32 with a valid check symbol', () => {
    for (const code of codes) {
      expect(code).toMatch(CODE_PATTERN);
      expect(isCertificateCodeWellFormed(code)).toBe(true);
    }
    expect(CERTIFICATE_ALPHABET).toHaveLength(32);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('is deterministic for the same bytes and ignores extra bytes', () => {
    const b = bytes(42, 16);
    expect(createCertificateCode(b)).toBe(createCertificateCode(b.slice(0, 11)));
    expect(createCertificateCode(bytes(7))).toBe(createCertificateCode(bytes(7)));
  });

  it('maps each byte to one symbol (low five bits)', () => {
    const counting = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(symbolsOf(createCertificateCode(counting)).slice(0, 11)).toBe('123456789AB');
    const high = Uint8Array.from([33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43]);
    expect(createCertificateCode(high)).toBe(createCertificateCode(counting));
  });

  it('needs enough random bytes', () => {
    expect(() => createCertificateCode(new Uint8Array(10))).toThrow(RangeError);
  });

  it("never puts 0 and Z side by side, the one swap Luhn mod 32 can't see", () => {
    const worstCase = [
      Uint8Array.from([0, 31, 0, 31, 0, 31, 0, 31, 0, 31, 0]),
      Uint8Array.from([31, 0, 31, 0, 31, 0, 31, 0, 31, 0, 31]),
      new Uint8Array(11),
      new Uint8Array(11).fill(31),
      new Uint8Array(11).fill(255),
    ];
    for (let last = 0; last < 32; last += 1) {
      worstCase.push(Uint8Array.from([5, 9, 1, 0, 3, 7, 2, 8, 4, 6, last]));
    }
    for (const b of [...worstCase, ...Array.from({ length: 400 }, (_, i) => bytes(1000 + i))]) {
      const code = createCertificateCode(b);
      expect(isCertificateCodeWellFormed(code)).toBe(true);
      expect(/0Z|Z0/.test(symbolsOf(code))).toBe(false);
    }
  });
});

describe('isCertificateCodeWellFormed', () => {
  it('catches every single-symbol typo', () => {
    for (const code of codes) {
      const symbols = symbolsOf(code);
      for (let i = 0; i < symbols.length; i += 1) {
        for (const other of CERTIFICATE_ALPHABET) {
          if (other === symbols[i]) continue;
          const typo = symbols.slice(0, i) + other + symbols.slice(i + 1);
          expect(isCertificateCodeWellFormed(asCode(typo))).toBe(false);
        }
      }
    }
  });

  it('catches every swap of two neighbouring symbols', () => {
    let swaps = 0;
    for (const code of codes) {
      const s = symbolsOf(code);
      for (let i = 0; i + 1 < s.length; i += 1) {
        if (s[i] === s[i + 1]) continue;
        const swapped = s.slice(0, i) + s.charAt(i + 1) + s.charAt(i) + s.slice(i + 2);
        expect(isCertificateCodeWellFormed(asCode(swapped))).toBe(false);
        swaps += 1;
      }
    }
    expect(swaps).toBeGreaterThan(1000);
  });

  it('rejects wrong lengths and characters outside the alphabet', () => {
    const code = codes[0] ?? '';
    expect(isCertificateCodeWellFormed(code.slice(0, -1))).toBe(false);
    expect(isCertificateCodeWellFormed(`${code}0`)).toBe(false);
    expect(isCertificateCodeWellFormed(code.replace(/.$/, 'U'))).toBe(false);
    expect(isCertificateCodeWellFormed('')).toBe(false);
    expect(isCertificateCodeWellFormed('not a code at all')).toBe(false);
  });
});

describe('normalizeCertificateCode', () => {
  it('accepts lowercase, spaces, hyphens and Crockford look-alikes', () => {
    const code = createCertificateCode(Uint8Array.from([0, 1, 1, 0, 20, 21, 22, 23, 24, 25, 26]));
    const plain = symbolsOf(code);
    expect(plain.startsWith('0110')).toBe(true);
    const typed = ` o${'Il' + plain.slice(3, 6).toLowerCase()} ${plain.slice(6, 9)} - ${plain.slice(9)} `;
    expect(normalizeCertificateCode(typed)).toBe(code);
    expect(isCertificateCodeWellFormed(typed)).toBe(true);
    expect(normalizeCertificateCode(plain)).toBe(code);
    expect(normalizeCertificateCode(code.replaceAll('-', '\u2013'))).toBe(code);
  });

  it("returns null for anything that can't be a code", () => {
    expect(normalizeCertificateCode('ABCD-EFGH-JKM')).toBeNull();
    expect(normalizeCertificateCode('ABCD-EFGH-JKMNP')).toBeNull();
    expect(normalizeCertificateCode('ABCD-EFGH-JKU0')).toBeNull();
    expect(normalizeCertificateCode('ABCD_EFGH_JKM0')).toBeNull();
    expect(normalizeCertificateCode('ÀBCD-EFGH-JKM0')).toBeNull();
  });
});

describe('certificateExpiry', () => {
  it('adds calendar months, clamping to the end of shorter months', () => {
    expect(certificateExpiry('2026-01-31', 1)).toBe('2026-02-28');
    expect(certificateExpiry('2028-01-31', 1)).toBe('2028-02-29');
    expect(certificateExpiry('2026-10-27', 12)).toBe('2027-10-27');
    expect(certificateExpiry('2028-02-29', 12)).toBe('2029-02-28');
    expect(certificateExpiry('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('is null without an expiry', () => {
    expect(certificateExpiry('2026-10-27')).toBeNull();
    expect(certificateExpiry('2026-10-27', null)).toBeNull();
  });

  it("refuses month counts that aren't whole and positive", () => {
    expect(() => certificateExpiry('2026-10-27', 0)).toThrow(RangeError);
    expect(() => certificateExpiry('2026-10-27', 1.5)).toThrow(RangeError);
  });
});

describe('certificateStatus', () => {
  const cert = { expiresOn: '2027-10-27' };

  it('is valid until the heads-up window, then expiring soon, then expired on the expiry day', () => {
    expect(certificateStatus(cert, '2027-09-26')).toBe('valid');
    expect(certificateStatus(cert, '2027-09-27')).toBe('expiring_soon');
    expect(certificateStatus(cert, '2027-10-26')).toBe('expiring_soon');
    expect(certificateStatus(cert, '2027-10-27')).toBe('expired');
    expect(certificateStatus(cert, '2028-01-01')).toBe('expired');
  });

  it('uses a custom heads-up window', () => {
    expect(certificateStatus(cert, '2027-10-19', 7)).toBe('valid');
    expect(certificateStatus(cert, '2027-10-20', 7)).toBe('expiring_soon');
    expect(certificateStatus(cert, '2027-10-26', 0)).toBe('valid');
  });

  it('treats a certificate without an expiry as always valid', () => {
    expect(certificateStatus({ expiresOn: null }, '2099-01-01')).toBe('valid');
    expect(certificateStatus({}, '2099-01-01')).toBe('valid');
  });
});
