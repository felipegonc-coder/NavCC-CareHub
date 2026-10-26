/**
 * Exact decimals for the Number property: canonical strings, with BigInt arithmetic.
 * Canonical form: optional "-", no leading zeros, no trailing fraction zeros, no "-0", no exponent.
 * Examples: "0", "-12.5", "1234567.0001".
 */
import type { NumberDecimals, NumberFormat } from './types';

/** Fraction digits kept by arithmetic (the Number property allows 10). */
export const DECIMAL_SCALE = 10;
const FACTOR = 10n ** BigInt(DECIMAL_SCALE);
const CANONICAL = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const LOOSE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export function isCanonicalDecimal(s: unknown): s is string {
  return typeof s === 'string' && CANONICAL.test(s) && s !== '-0';
}

function canonical(neg: boolean, intPart: string, fracPart: string): string {
  const i = intPart.replace(/^0+(?=\d)/, '') || '0';
  const f = fracPart.replace(/0+$/, '');
  const body = f ? `${i}.${f}` : i;
  return neg && body !== '0' ? `-${body}` : body;
}

/**
 * Reads a plain decimal ("+1.50", ".5", "12.", "1e3") into canonical form, or null.
 * Doesn't accept commas, spaces or currency signs: user input is cleaned by values.ts first.
 */
export function normalizeDecimal(input: string): string | null {
  const r = LOOSE.exec(input.trim());
  if (!r) return null;
  const sign = r[1] ?? '';
  let intPart = r[2] ?? '';
  let fracPart = r[3] ?? '';
  if (!intPart && !fracPart) return null;
  const exp = r[4] ? Number(r[4]) : 0;
  if (!Number.isFinite(exp) || Math.abs(exp) > 400) return null;
  if (exp > 0) {
    fracPart = fracPart.padEnd(exp, '0');
    intPart += fracPart.slice(0, exp);
    fracPart = fracPart.slice(exp);
  } else if (exp < 0) {
    intPart = intPart.padStart(-exp, '0');
    fracPart = intPart.slice(intPart.length + exp) + fracPart;
    intPart = intPart.slice(0, intPart.length + exp);
  }
  return canonical(sign === '-', intPart, fracPart);
}

/** True if it fits the Number property: up to 15 digits before the point and 10 after. */
export function fitsNumberLimits(d: string): boolean {
  if (!isCanonicalDecimal(d)) return false;
  const [i = '', f = ''] = d.replace('-', '').split('.');
  return i.length <= 15 && f.length <= DECIMAL_SCALE;
}

/** Rounds half away from zero to `places` fraction digits. */
export function roundDecimal(d: string, places: number): string {
  const neg = d.startsWith('-');
  const [i = '0', f = ''] = d.replace('-', '').split('.');
  if (f.length <= places) return d;
  const kept = BigInt(i + f.slice(0, places)) + (Number(f[places]) >= 5 ? 1n : 0n);
  return fromBigIntScaled(neg ? -kept : kept, places);
}

function fromBigIntScaled(v: bigint, places: number): string {
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString().padStart(places + 1, '0');
  return canonical(
    neg,
    digits.slice(0, digits.length - places),
    digits.slice(digits.length - places),
  );
}

/** Scaled by 10^10 (rounded to 10 fraction digits). */
export function toScaled(d: string): bigint {
  const r = roundDecimal(d, DECIMAL_SCALE);
  const neg = r.startsWith('-');
  const [i = '0', f = ''] = r.replace('-', '').split('.');
  const v = BigInt(i) * FACTOR + BigInt(f.padEnd(DECIMAL_SCALE, '0'));
  return neg ? -v : v;
}

export function fromScaled(v: bigint): string {
  return fromBigIntScaled(v, DECIMAL_SCALE);
}

export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = toScaled(a);
  const y = toScaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function addDecimal(a: string, b: string): string {
  return fromScaled(toScaled(a) + toScaled(b));
}

export function subtractDecimal(a: string, b: string): string {
  return fromScaled(toScaled(a) - toScaled(b));
}

export function negateDecimal(a: string): string {
  return fromScaled(-toScaled(a));
}

function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  if ((an % ad) * 2n >= ad) q += 1n;
  return neg ? -q : q;
}

export function multiplyDecimal(a: string, b: string): string {
  return fromScaled(divRound(toScaled(a) * toScaled(b), FACTOR));
}

/** null when dividing by zero. */
export function divideDecimal(a: string, b: string): string | null {
  const y = toScaled(b);
  if (y === 0n) return null;
  return fromScaled(divRound(toScaled(a) * FACTOR, y));
}

/** Multiplies by 10^places exactly (percent: "45" shifted by -2 is "0.45"). */
export function shiftDecimal(d: string, places: number): string {
  const neg = d.startsWith('-');
  const [i = '0', f = ''] = d.replace('-', '').split('.');
  const digits = i + f;
  const point = i.length + places;
  const whole = point <= 0 ? '0' : digits.padEnd(point, '0').slice(0, point);
  const frac = point <= 0 ? '0'.repeat(-point) + digits : digits.slice(point);
  return roundDecimal(canonical(neg, whole, frac), DECIMAL_SCALE);
}

export function decimalToNumber(d: string): number {
  return Number(d);
}

/** A JavaScript number as a canonical decimal (rounded to 10 places); null for NaN and Infinity. */
export function numberToDecimal(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = normalizeDecimal(String(n));
  return s === null ? null : roundDecimal(s, DECIMAL_SCALE);
}

export interface DecimalFormat {
  format: NumberFormat;
  decimals: NumberDecimals;
  /** ISO 4217, used when format is "currency". Default "USD". */
  currency?: string;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** As shown in cells and CSV export: "1234.5", "1,234.5", "45%", "$1,234.50". */
export function formatDecimal(d: string, f: DecimalFormat): string {
  const fixed = f.decimals === 'auto' ? null : f.decimals;
  const opts: Intl.NumberFormatOptions = { useGrouping: f.format !== 'number' };
  if (f.format === 'percent') opts.style = 'percent';
  if (f.format === 'currency') {
    opts.style = 'currency';
    opts.currency = f.currency ?? 'USD';
  }
  if (fixed !== null) {
    opts.minimumFractionDigits = fixed;
    opts.maximumFractionDigits = fixed;
  } else if (f.format !== 'currency') {
    opts.maximumFractionDigits = f.format === 'percent' ? DECIMAL_SCALE - 2 : DECIMAL_SCALE;
  }
  const key = JSON.stringify(opts);
  let nf = numberFormats.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat('en-US', opts);
    numberFormats.set(key, nf);
  }
  // Intl formats decimal strings exactly (no float rounding).
  return (nf.format as unknown as (v: string) => string)(d);
}
