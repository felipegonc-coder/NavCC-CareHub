// MD5 (RFC 1321). Only for matching an Evernote note's <en-media hash="..."> to its <resource>:
// the hash is the MD5 of the resource's bytes, and WebCrypto has no MD5. Never for anything
// secret.

/** How far each step rotates. */
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
/** The 64 constants: the first 32 bits of |sin(i + 1)|. */
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

/** The MD5 of `bytes`, as 32 lowercase hex digits. */
export function md5Hex(bytes: Uint8Array): string {
  const length = bytes.length;
  // The bytes, a 1 bit, zeros, then the length in bits (64-bit little-endian): 64-byte blocks.
  const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (length * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(length / 0x20000000), true);

  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let block = 0; block < padded.length; block += 64) {
    let [a = 0, b = 0, c = 0, d = 0] = state;
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      let f: number;
      let word: number;
      if (round === 0) {
        f = (b & c) | (~b & d);
        word = i;
      } else if (round === 1) {
        f = (d & b) | (~d & c);
        word = (5 * i + 1) % 16;
      } else if (round === 2) {
        f = b ^ c ^ d;
        word = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        word = (7 * i) % 16;
      }
      const shift = SHIFTS[round * 4 + (i % 4)] ?? 0;
      const sum = (a + f + (K[i] ?? 0) + view.getUint32(block + word * 4, true)) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    state[0] = ((state[0] ?? 0) + a) | 0;
    state[1] = ((state[1] ?? 0) + b) | 0;
    state[2] = ((state[2] ?? 0) + c) | 0;
    state[3] = ((state[3] ?? 0) + d) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  state.forEach((word, i) => out.setUint32(i * 4, word, true));
  let hex = '';
  for (let i = 0; i < 16; i++) hex += out.getUint8(i).toString(16).padStart(2, '0');
  return hex;
}
