import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './base64url';

describe('base64url', () => {
  it('encodes without padding and with the URL-safe alphabet', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(toBase64Url(new Uint8Array([]))).toBe('');
  });

  it('decodes with or without padding', () => {
    expect([...fromBase64Url('-_8')]).toEqual([0xfb, 0xff]);
    expect([...fromBase64Url('-_8=')]).toEqual([0xfb, 0xff]);
  });

  it('refuses other characters and impossible lengths', () => {
    expect(() => fromBase64Url('+/8')).toThrow(TypeError);
    expect(() => fromBase64Url('ab cd')).toThrow(TypeError);
    expect(() => fromBase64Url('abcde')).toThrow(TypeError);
  });
});
