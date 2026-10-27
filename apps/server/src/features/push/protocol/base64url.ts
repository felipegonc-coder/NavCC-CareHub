// Base64url without padding (RFC 4648 section 5), the encoding Web Push uses for keys and tokens.

const BASE64URL = /^[A-Za-z0-9_-]*={0,2}$/;

/** Encodes bytes as base64url without `=` padding. */
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Decodes base64url, with or without `=` padding. Throws a `TypeError` on any other character:
 * Node's own decoder skips them silently, which would hide a mangled key.
 */
export function fromBase64Url(text: string): Uint8Array {
  if (!BASE64URL.test(text) || text.replace(/=+$/, '').length % 4 === 1) {
    throw new TypeError('Not valid base64url.');
  }
  return Buffer.from(text, 'base64url');
}
