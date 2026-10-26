import type { Id } from './types';

/** The part of Web Crypto this needs; present in browsers and Node 24 (the package has no DOM or Node types). */
interface RandomSource {
  randomUUID?: () => string;
  getRandomValues<T extends Uint8Array>(array: T): T;
}

/** A random UUID (works in browsers outside secure contexts too). */
export function newId(): Id {
  const c = (globalThis as unknown as { crypto: RandomSource }).crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
