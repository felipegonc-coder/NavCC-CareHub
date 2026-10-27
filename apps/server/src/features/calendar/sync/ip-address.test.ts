import { describe, expect, it } from 'vitest';
import { blockedReason, isPublicAddress } from './ip-address';

describe('blockedReason', () => {
  it('refuses IPv4 addresses that are not public', () => {
    const cases: [string, string][] = [
      ['0.0.0.0', 'this network'],
      ['10.1.2.3', 'private'],
      ['100.64.0.1', 'shared (CGNAT)'],
      ['127.0.0.1', 'loopback'],
      ['169.254.169.254', 'link-local'],
      ['172.16.0.1', 'private'],
      ['172.31.255.255', 'private'],
      ['192.0.0.8', 'reserved'],
      ['192.0.2.10', 'documentation'],
      ['192.168.1.1', 'private'],
      ['198.18.0.1', 'benchmarking'],
      ['198.51.100.7', 'documentation'],
      ['203.0.113.9', 'documentation'],
      ['224.0.0.1', 'multicast'],
      ['239.255.255.250', 'multicast'],
      ['240.0.0.1', 'reserved'],
      ['255.255.255.255', 'reserved'],
    ];
    for (const [address, reason] of cases) expect(blockedReason(address)).toBe(reason);
  });

  it('refuses IPv6 addresses that are not public, including IPv4 inside IPv6', () => {
    const cases: [string, string][] = [
      ['::', 'unspecified'],
      ['::1', 'loopback'],
      ['[::1]', 'loopback'],
      ['::ffff:127.0.0.1', 'loopback'],
      ['::ffff:7f00:1', 'loopback'],
      ['::ffff:10.0.0.1', 'private'],
      ['64:ff9b::a9fe:a9fe', 'link-local'],
      ['64:ff9b:1::1', 'reserved'],
      ['::127.0.0.1', 'reserved'],
      ['2001::1', 'reserved'],
      ['2001:db8::1', 'documentation'],
      ['2002:c000:204::1', 'reserved'],
      ['3fff::1', 'documentation'],
      ['5f00::1', 'reserved'],
      ['fc00::1', 'private'],
      ['fd12:3456::1', 'private'],
      ['fe80::1', 'link-local'],
      ['fe80::1%eth0', 'scoped'],
      ['ff02::1', 'multicast'],
    ];
    for (const [address, reason] of cases) expect(blockedReason(address)).toBe(reason);
  });

  it('allows public addresses', () => {
    for (const address of [
      '93.184.216.34',
      '11.0.0.1',
      '100.128.0.1',
      '172.32.0.1',
      '198.20.0.1',
      '223.255.255.255',
      '2606:2800:220:1:248:1893:25c8:1946',
      '::ffff:93.184.216.34',
      '64:ff9b::5db8:d822',
    ]) {
      expect(blockedReason(address)).toBeUndefined();
      expect(isPublicAddress(address)).toBe(true);
    }
  });

  it('refuses things that are not addresses', () => {
    for (const text of ['', 'calendar.example.com', '1.2.3', '999.1.1.1', ':::1']) {
      expect(blockedReason(text)).toBe('not an IP address');
      expect(isPublicAddress(text)).toBe(false);
    }
  });
});
