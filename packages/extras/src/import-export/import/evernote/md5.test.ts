import { describe, expect, it } from 'vitest';
import { md5Hex } from './md5';

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('md5Hex', () => {
  it('matches the RFC 1321 test suite', () => {
    const suite: [string, string][] = [
      ['', 'd41d8cd98f00b204e9800998ecf8427e'],
      ['a', '0cc175b9c0f1b6a831c399e269772661'],
      ['abc', '900150983cd24fb0d6963f7d28e17f72'],
      ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
      ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
      [
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        'd174ab98d277d9f5a5611c2c9f419d9f',
      ],
      [
        '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
        '57edf4a22be3c955ac49da2e2107b67a',
      ],
    ];
    for (const [text, hash] of suite) expect(md5Hex(ascii(text))).toBe(hash);
  });

  it('pads lengths around a block edge', () => {
    // 55 and 56 bytes: the length fits in the first block, then needs a second one.
    expect(md5Hex(ascii('a'.repeat(55)))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(md5Hex(ascii('a'.repeat(56)))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(md5Hex(ascii('a'.repeat(64)))).toBe('014842d480b571495a4a0363793f7367');
  });
});
