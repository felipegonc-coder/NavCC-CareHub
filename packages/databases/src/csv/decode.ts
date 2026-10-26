/**
 * The text of an uploaded CSV or TSV file (spec 3.7): UTF-8 with or without a byte order mark,
 * otherwise Windows-1252 (what older spreadsheet programs save). Decoded by hand because the
 * package can't assume TextDecoder.
 */

/** Windows-1252 characters for bytes 0x80–0x9F; every other byte is the same code point in Unicode. */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
  0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
  0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** Collects code points into a string in chunks (no quadratic concatenation on big files). */
class TextBuilder {
  private readonly parts: string[] = [];
  private units: number[] = [];

  push(cp: number): void {
    // NUL never means anything in a CSV file, and Postgres text can't store it.
    if (cp === 0) return;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      this.units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      this.units.push(cp);
    }
    if (this.units.length >= 8192) this.flush();
  }

  done(): string {
    this.flush();
    return this.parts.join('');
  }

  private flush(): void {
    if (this.units.length) this.parts.push(String.fromCharCode(...this.units));
    this.units = [];
  }
}

/**
 * UTF-8 from `from` on. Strict: null at the first invalid sequence (overlong forms, surrogates and
 * code points past U+10FFFF are invalid), unless `replace` is set, which puts U+FFFD instead.
 */
function decodeUtf8(bytes: Uint8Array, from: number, replace: boolean): string | null {
  const out = new TextBuilder();
  const at = (k: number): number => bytes[k] ?? -1;
  let i = from;
  while (i < bytes.length) {
    const b = at(i);
    if (b < 0x80) {
      out.push(b);
      i++;
      continue;
    }
    let need = 0;
    let cp = 0;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      cp = b & 0x1f;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      cp = b & 0x0f;
      if (b === 0xe0) lo = 0xa0;
      if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      cp = b & 0x07;
      if (b === 0xf0) lo = 0x90;
      if (b === 0xf4) hi = 0x8f;
    }
    let k = 1;
    for (; k <= need; k++) {
      const c = at(i + k);
      if (c < (k === 1 ? lo : 0x80) || c > (k === 1 ? hi : 0xbf)) break;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (need === 0 || k <= need) {
      if (!replace) return null;
      out.push(0xfffd);
      // Skip the lead byte and the continuation bytes that were valid so far.
      i += k;
      continue;
    }
    out.push(cp);
    i += need + 1;
  }
  return out.done();
}

function decodeWindows1252(bytes: Uint8Array): string {
  const out = new TextBuilder();
  for (const b of bytes) out.push(b >= 0x80 && b < 0xa0 ? (CP1252_HIGH[b - 0x80] ?? b) : b);
  return out.done();
}

/**
 * The text of a CSV file. A UTF-8 byte order mark is dropped (and the rest is read as UTF-8 with
 * U+FFFD for broken bytes); without one, the file is UTF-8 if every byte sequence is valid UTF-8,
 * otherwise Windows-1252. NUL characters are dropped.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeUtf8(bytes, 3, true) ?? '';
  }
  return decodeUtf8(bytes, 0, false) ?? decodeWindows1252(bytes);
}
