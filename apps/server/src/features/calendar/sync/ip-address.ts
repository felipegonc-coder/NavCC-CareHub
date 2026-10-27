// Which addresses a calendar link may reach: public unicast only. Everything else (loopback,
// private, link-local, CGNAT, multicast, reserved, documentation, and the IPv6 equivalents,
// including IPv4 addresses inside IPv6) is refused, so a link can't probe Care Hub's network.

import { isIPv4, isIPv6 } from 'node:net';

type Range = readonly [prefix: string, bits: number, reason: string];

const IPV4_BLOCKED: readonly Range[] = [
  ['0.0.0.0', 8, 'this network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'shared (CGNAT)'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'reserved'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.88.99.0', 24, 'reserved'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

// Checked in order; the first match decides. Outside 2000::/3 everything is refused.
const IPV6_RULES: readonly (readonly [prefix: string, bits: number, rule: string])[] = [
  ['::', 128, 'unspecified'],
  ['::1', 128, 'loopback'],
  ['::ffff:0:0', 96, 'ipv4'], // IPv4-mapped
  ['64:ff9b::', 96, 'ipv4'], // NAT64
  ['64:ff9b:1::', 48, 'reserved'],
  ['2001::', 23, 'reserved'], // includes Teredo and benchmarking
  ['2001:db8::', 32, 'documentation'],
  ['2002::', 16, 'reserved'], // 6to4
  ['3fff::', 20, 'documentation'],
  ['2000::', 3, 'public'],
  ['fc00::', 7, 'private'],
  ['fe80::', 10, 'link-local'],
  ['ff00::', 8, 'multicast'],
];

/** Why an address must not be used, or undefined for a public address. */
export function blockedReason(address: string): string | undefined {
  const text = address.trim().replace(/^\[|\]$/g, '');
  if (text.includes('%')) return 'scoped';
  const v4 = parseIPv4(text);
  if (v4) {
    return IPV4_BLOCKED.find(([prefix, bits]) => inPrefix(v4, parseIPv4(prefix)!, bits))?.[2];
  }
  const v6 = parseIPv6(text);
  if (!v6) return 'not an IP address';
  const rule = IPV6_RULES.find(([prefix, bits]) => inPrefix(v6, parseIPv6(prefix)!, bits))?.[2];
  if (rule === 'public') return undefined;
  if (rule === 'ipv4') return blockedReason(Array.from(v6.subarray(12)).join('.'));
  return rule ?? 'reserved';
}

export function isPublicAddress(address: string): boolean {
  return blockedReason(address) === undefined;
}

function parseIPv4(text: string): Uint8Array | undefined {
  if (!isIPv4(text)) return undefined;
  return Uint8Array.from(text.split('.').map(Number));
}

function parseIPv6(text: string): Uint8Array | undefined {
  if (!isIPv6(text)) return undefined;
  // An IPv4 tail ("::ffff:192.0.2.1") becomes two hex groups.
  const withoutV4 = text.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) =>
    [(+a << 8) | +b, (+c << 8) | +d].map((n) => n.toString(16)).join(':'),
  );
  const [left = '', right] = withoutV4.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const groups =
    right === undefined
      ? head
      : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  if (groups.length !== 8) return undefined;
  const bytes = new Uint8Array(16);
  groups.forEach((group, i) => {
    const value = parseInt(group, 16);
    bytes[i * 2] = value >> 8;
    bytes[i * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function inPrefix(address: Uint8Array, prefix: Uint8Array, bits: number): boolean {
  if (address.length !== prefix.length) return false;
  for (let i = 0; i < bits; i++) {
    const mask = 0x80 >> (i % 8);
    if ((address[i >> 3]! & mask) !== (prefix[i >> 3]! & mask)) return false;
  }
  return true;
}
