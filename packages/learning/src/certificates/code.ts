/**
 * Certificate verification codes: 11 random Crockford base32 symbols plus one Luhn mod 32 check
 * symbol, shown as "XXXX-XXXX-XXXX". The check symbol only catches typos; whether a code was really
 * issued is always a server lookup.
 */

/** Crockford base32 symbols: 0-9 and A-Z without I, L, O and U. */
export const CERTIFICATE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** How many random bytes `createCertificateCode` reads (one per random symbol). */
export const CERTIFICATE_CODE_RANDOM_BYTES = 11;

const RADIX = 32;
const DATA_SYMBOLS = 11;
const CODE_SYMBOLS = DATA_SYMBOLS + 1;
const Z = RADIX - 1;
const SEPARATORS = /[\s\u2010-\u2015\u2212-]/g;

/** Luhn mod 32 remainder of `values`, with `firstFactor` applied to the rightmost value. */
function luhnRemainder(values: readonly number[], firstFactor: 1 | 2): number {
  let factor = firstFactor;
  let sum = 0;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const product = factor * (values[i] ?? 0);
    sum += Math.floor(product / RADIX) + (product % RADIX);
    factor = factor === 2 ? 1 : 2;
  }
  return sum % RADIX;
}

function checkValue(data: readonly number[]): number {
  return (RADIX - luhnRemainder(data, 2)) % RADIX;
}

/**
 * Luhn mod 32 catches every adjacent swap except "0" with "Z" (their weighted values coincide),
 * so issued codes never put those two side by side.
 */
function isBlindPair(a: number, b: number): boolean {
  return (a === 0 && b === Z) || (a === Z && b === 0);
}

function display(values: readonly number[]): string {
  const symbols = values.map((v) => CERTIFICATE_ALPHABET.charAt(v)).join('');
  return `${symbols.slice(0, 4)}-${symbols.slice(4, 8)}-${symbols.slice(8)}`;
}

/**
 * Creates a certificate code such as "7KQ2-M9XD-4TB8" from at least
 * `CERTIFICATE_CODE_RANDOM_BYTES` random bytes (pass `crypto.getRandomValues(new Uint8Array(11))`).
 * Each byte gives one symbol from its low five bits; the same bytes always give the same code.
 */
export function createCertificateCode(randomBytes: Uint8Array): string {
  if (randomBytes.length < CERTIFICATE_CODE_RANDOM_BYTES) {
    throw new RangeError(
      `createCertificateCode needs ${CERTIFICATE_CODE_RANDOM_BYTES} random bytes`,
    );
  }
  const data: number[] = [];
  for (let i = 0; i < DATA_SYMBOLS; i += 1) {
    let value = (randomBytes[i] ?? 0) & Z;
    const previous = data[i - 1];
    if (previous !== undefined && isBlindPair(previous, value)) value = (value + 1) % RADIX;
    data.push(value);
  }
  let check = checkValue(data);
  // Rarely the check symbol and the last random symbol form the blind pair: nudge the last random
  // symbol (at most a few steps) until neither neighbour pair is blind.
  while (isBlindPair(data[DATA_SYMBOLS - 1] ?? 0, check)) {
    do {
      data[DATA_SYMBOLS - 1] = ((data[DATA_SYMBOLS - 1] ?? 0) + 1) % RADIX;
    } while (isBlindPair(data[DATA_SYMBOLS - 2] ?? 0, data[DATA_SYMBOLS - 1] ?? 0));
    check = checkValue(data);
  }
  return display([...data, check]);
}

function symbolValues(code: string): number[] | null {
  const cleaned = code.normalize('NFKC').replace(SEPARATORS, '');
  if (cleaned.length !== CODE_SYMBOLS) return null;
  const values: number[] = [];
  for (const raw of cleaned) {
    const upper = raw >= 'a' && raw <= 'z' ? raw.toUpperCase() : raw;
    const symbol = upper === 'O' ? '0' : upper === 'I' || upper === 'L' ? '1' : upper;
    const value = CERTIFICATE_ALPHABET.indexOf(symbol);
    if (value < 0) return null;
    values.push(value);
  }
  return values;
}

/**
 * Normalises what someone typed into "XXXX-XXXX-XXXX": accepts lowercase, spaces and hyphens, and
 * reads the Crockford look-alikes O as 0 and I or L as 1. Returns null when it can't be a code
 * (wrong length or other characters). It does not check the check symbol.
 */
export function normalizeCertificateCode(input: string): string | null {
  const values = symbolValues(input);
  return values === null ? null : display(values);
}

/**
 * True when `code` (in any accepted spelling) has 12 symbols and a matching check symbol. Catches
 * every single-symbol typo and every swap of two neighbouring symbols in an issued code.
 */
export function isCertificateCodeWellFormed(code: string): boolean {
  const values = symbolValues(code);
  return values !== null && luhnRemainder(values, 1) === 0;
}
