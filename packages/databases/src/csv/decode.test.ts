import { describe, expect, it } from 'vitest';
import { decodeCsvBytes } from './decode';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);
const BOM = [0xef, 0xbb, 0xbf];

/** Windows-1252 bytes 0x80–0x9F (five of them are unused and keep their own code point). */
const CP1252_80_9F = String.fromCharCode(
  0x20ac,
  0x81,
  0x201a,
  0x192,
  0x201e,
  0x2026,
  0x2020,
  0x2021,
  0x2c6,
  0x2030,
  0x160,
  0x2039,
  0x152,
  0x8d,
  0x17d,
  0x8f,
  0x90,
  0x2018,
  0x2019,
  0x201c,
  0x201d,
  0x2022,
  0x2013,
  0x2014,
  0x2dc,
  0x2122,
  0x161,
  0x203a,
  0x153,
  0x9d,
  0x17e,
  0x178,
);

describe('decodeCsvBytes', () => {
  it('reads UTF-8 without a byte order mark', () => {
    const text = 'Name,Notes\r\nAvery Lin,Caf\u00e9 \u2013 \u2713 \u{1F600}\r\n';
    expect(decodeCsvBytes(utf8(text))).toBe(text);
  });

  it('drops a UTF-8 byte order mark', () => {
    expect(decodeCsvBytes(utf8('\uFEFFName\r\nJordan Park'))).toBe('Name\r\nJordan Park');
  });

  it('reads an empty file', () => {
    expect(decodeCsvBytes(bytes())).toBe('');
    expect(decodeCsvBytes(bytes(...BOM))).toBe('');
  });

  it('reads Windows-1252 when the bytes are not UTF-8', () => {
    // "Café – “B” €5" as older spreadsheet programs save it.
    const file = bytes(
      0x43,
      0x61,
      0x66,
      0xe9,
      0x20,
      0x96,
      0x20,
      0x93,
      0x42,
      0x94,
      0x20,
      0x80,
      0x35,
    );
    expect(decodeCsvBytes(file)).toBe('Caf\u00e9 \u2013 \u201cB\u201d \u20ac5');
  });

  it('maps every Windows-1252 byte above 0x7F', () => {
    const text = decodeCsvBytes(bytes(...Array.from({ length: 128 }, (_, i) => 0x80 + i)));
    expect(text.slice(0, 32)).toBe(CP1252_80_9F);
    expect(text.slice(32)).toBe(
      String.fromCharCode(...Array.from({ length: 96 }, (_, i) => 0xa0 + i)),
    );
  });

  it.each([
    ['an overlong form', [0xc0, 0xaf], '\u00c0\u00af'],
    ['an overlong three-byte form', [0xe0, 0x80, 0xaf], '\u00e0\u20ac\u00af'],
    ['a surrogate', [0xed, 0xa0, 0x80], '\u00ed\u00a0\u20ac'],
    ['a code point past U+10FFFF', [0xf4, 0x90, 0x80, 0x80], '\u00f4\u0090\u20ac\u20ac'],
    ['a sequence cut off at the end', [0x43, 0x61, 0x66, 0xc3], 'Caf\u00c3'],
    ['a lone continuation byte', [0x41, 0x81, 0xff], 'A\u0081\u00ff'],
  ])('reads a file with %s as Windows-1252', (_, input: number[], expected: string) => {
    expect(decodeCsvBytes(bytes(...input))).toBe(expected);
  });

  it('puts U+FFFD for broken bytes after a byte order mark', () => {
    expect(decodeCsvBytes(bytes(...BOM, 0x41, 0xe9, 0x42, 0xc3))).toBe('A\uFFFDB\uFFFD');
    expect(decodeCsvBytes(bytes(...BOM, 0xe2, 0x82, 0x41))).toBe('\uFFFDA');
  });

  it('drops NUL characters', () => {
    expect(decodeCsvBytes(utf8('A\u0000B'))).toBe('AB');
    expect(decodeCsvBytes(bytes(0x41, 0x00, 0xe9))).toBe('A\u00e9');
  });

  it('reads long files', () => {
    const text = `${'Avery Lin,'.repeat(5000)}\u{1F600}\r\n`.repeat(3);
    expect(decodeCsvBytes(utf8(text))).toBe(text);
    expect(decodeCsvBytes(Uint8Array.from([...BOM, ...utf8(text)]))).toBe(text);
  });
});
