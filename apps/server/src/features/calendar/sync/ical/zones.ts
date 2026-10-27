// Time zone arithmetic with Intl only, and TZID names (IANA, Windows, path-prefixed).

import { civilToMs, DAY_MS, MINUTE_MS, msToCivil, parseCivil } from './values';
import type { Civil } from './values';
import { WINDOWS_ZONES } from './windows-zones';

const formatters = new Map<string, Intl.DateTimeFormat>();
const windowsZones = new Map(WINDOWS_ZONES.map(([id, zone]) => [id.toLowerCase(), zone]));

/**
 * The IANA zone name for `name`, or undefined when Intl doesn't know it. Keeps the name as
 * given (so 'Asia/Kolkata' isn't swapped for an older alias) and only fixes its case.
 */
export function ianaZone(name: string): string | undefined {
  if (!/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(name)) return undefined;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', {
      timeZone: name,
    }).resolvedOptions();
    return resolved.timeZone.toLowerCase() === name.toLowerCase() ? resolved.timeZone : name;
  } catch {
    return undefined;
  }
}

/**
 * Reads a TZID as an IANA zone: an IANA name, a Windows ID ("Eastern Standard Time"), or an
 * IANA name behind a path prefix ("/mozilla.org/20050126_1/America/New_York").
 */
export function zoneFromTzid(tzid: string): string | undefined {
  const name = tzid.trim().replace(/^"|"$/g, '');
  const direct = ianaZone(name) ?? windowsZones.get(name.toLowerCase());
  if (direct) return direct;
  const parts = name.split('/');
  for (let i = 1; i < parts.length; i++) {
    const zone = ianaZone(parts.slice(i).join('/'));
    if (zone) return zone;
  }
  return undefined;
}

/** Windows mapping targets, in preference order. */
export function preferredZones(): string[] {
  return [...new Set(WINDOWS_ZONES.map(([, zone]) => zone))];
}

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** UTC offset of an IANA zone at an instant, in minutes (east is positive). */
export function zoneOffset(zone: string, ms: number): number {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(ms)) parts[part.type] = Number(part.value);
  const wall =
    civilToMs({
      year: parts.year ?? 1970,
      month: parts.month ?? 1,
      day: parts.day ?? 1,
      hour: parts.hour ?? 0,
      minute: parts.minute ?? 0,
    }) +
    (parts.second ?? 0) * 1000;
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / MINUTE_MS);
}

/**
 * The instant a wall-clock time names, given a zone's offset function. As RFC 5545 3.3.5
 * says, a repeated time means the first one, and a skipped time uses the offset before the gap.
 */
export function wallToUtc(wallMs: number, offsetAt: (ms: number) => number): number {
  const before = offsetAt(wallMs - DAY_MS);
  const after = offsetAt(wallMs + DAY_MS);
  const valid = [before, after]
    .map((offset) => wallMs - offset * MINUTE_MS)
    .filter((ms) => offsetAt(ms) * MINUTE_MS === wallMs - ms);
  return valid.length > 0 ? Math.min(...valid) : wallMs - before * MINUTE_MS;
}

/** Instant (ms) of a 'YYYY-MM-DDTHH:mm' wall-clock time in an IANA zone. */
export function zonedToMs(dateTime: string, zone: string): number | undefined {
  const civil = parseCivil(dateTime);
  return civil && wallToUtc(civilToMs(civil), (ms) => zoneOffset(zone, ms));
}

/** Wall-clock time of an instant in an IANA zone. */
export function msToZoned(ms: number, zone: string): Civil {
  return msToCivil(ms + zoneOffset(zone, ms) * MINUTE_MS);
}
