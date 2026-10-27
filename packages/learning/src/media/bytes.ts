// Small byte-reading helpers for the media module (not exported from the package).

/** Byte at `at`, or 0 past the end. */
export const byteAt = (b: Uint8Array, at: number): number => b[at] ?? 0;
/** Unsigned whole numbers at `at`: 16, 24 or 32 bits, big-endian (be) or little-endian (le). */
export const u16be = (b: Uint8Array, at: number): number =>
  (byteAt(b, at) << 8) | byteAt(b, at + 1);
export const u16le = (b: Uint8Array, at: number): number =>
  byteAt(b, at) | (byteAt(b, at + 1) << 8);
export const u24le = (b: Uint8Array, at: number): number =>
  u16le(b, at) | (byteAt(b, at + 2) << 16);
export const u32be = (b: Uint8Array, at: number): number =>
  u16be(b, at) * 0x10000 + u16be(b, at + 2);
export const u32le = (b: Uint8Array, at: number): number =>
  u16le(b, at) + u16le(b, at + 2) * 0x10000;

/** The bytes from `start` to `end` read as Latin-1 text (only for comparing with ASCII signatures). */
export function ascii(b: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < Math.min(end, b.length); i++) out += String.fromCharCode(byteAt(b, i));
  return out;
}

/** True when the bytes at `at` spell `text` (ASCII). */
export const hasAscii = (b: Uint8Array, text: string, at = 0): boolean =>
  ascii(b, at, at + text.length) === text;

/** Position of the ASCII `text` in the bytes (UTF-16LE when `wide`), searching from `from` up to `to`, or -1. */
export function findAscii(
  b: Uint8Array,
  text: string,
  from = 0,
  to = b.length,
  wide = false,
): number {
  const step = wide ? 2 : 1;
  const length = text.length * step;
  const first = text.charCodeAt(0);
  outer: for (let i = from; i + length <= Math.min(to, b.length); i++) {
    if (b[i] !== first) continue;
    for (let k = 1; k < text.length; k++) {
      if (b[i + k * step] !== text.charCodeAt(k) || (wide && b[i + k * step + 1] !== 0))
        continue outer;
    }
    return i;
  }
  return -1;
}

type Utf8Decoder = { decode(input: Uint8Array): string };
// TextDecoder exists in browsers and Node; typed locally so this package needs no DOM or Node types.
const Decoder = (
  globalThis as unknown as {
    TextDecoder: new (label: string, options: { fatal: boolean }) => Utf8Decoder;
  }
).TextDecoder;

/** The text of UTF-8 bytes (a byte-order mark is dropped), or null when the bytes aren't valid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new Decoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
