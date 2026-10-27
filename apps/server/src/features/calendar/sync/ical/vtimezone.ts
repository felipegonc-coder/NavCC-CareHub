// VTIMEZONE components (RFC 5545 3.6.5). Reading: a custom zone's offsets over time, and the
// IANA zone that behaves the same, so events can keep a real zone instead of a fixed
// conversion. Writing: a VTIMEZONE for an IANA zone, built from Intl.

import { stripControls } from './text';
import type { Component, ContentLine } from './text';
import {
  civilToMs,
  daysInMonth,
  DAY_MS,
  formatIcalDateTime,
  formatIcalUtc,
  formatUtcOffset,
  MINUTE_MS,
  msToCivil,
  parseIcalDateTime,
  parseUtcOffset,
  weekday,
} from './values';
import type { Civil } from './values';
import { preferredZones, wallToUtc, zoneFromTzid, zoneOffset } from './zones';

export interface CustomZone {
  tzid: string;
  location?: string; // X-LIC-LOCATION, when it names an IANA zone
  names: string[]; // TZNAME values, used as hints when matching
  transitions: { at: number; from: number; to: number }[]; // sorted by instant
}

const LAST_YEAR = 2100;
const MAX_ONSETS = 20_000; // per VTIMEZONE, so a hostile rule can't run away
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Reads a VTIMEZONE; undefined when it has no usable STANDARD or DAYLIGHT part. */
export function readVTimezone(component: Component): CustomZone | undefined {
  const get = (c: Component, name: string) => c.props.find((p) => p.name === name);
  const tzid = get(component, 'TZID')?.value.trim();
  if (!tzid) return undefined;
  const transitions: CustomZone['transitions'] = [];
  const names: string[] = [];
  for (const part of component.children) {
    if (part.name !== 'STANDARD' && part.name !== 'DAYLIGHT') continue;
    const start = parseIcalDateTime(get(part, 'DTSTART')?.value ?? '');
    const from = parseUtcOffset(get(part, 'TZOFFSETFROM')?.value ?? '');
    const to = parseUtcOffset(get(part, 'TZOFFSETTO')?.value ?? '');
    if (!start || from === undefined || to === undefined) continue;
    const name = get(part, 'TZNAME')?.value.trim();
    if (name) names.push(name);
    const budget = MAX_ONSETS - transitions.length;
    const onsets = [
      start.civil,
      ...rdates(part.props),
      ...expandRule(part, start.civil, from, budget),
    ];
    for (const onset of onsets.slice(0, budget)) {
      transitions.push({ at: civilToMs(onset) - from * MINUTE_MS, from, to });
    }
  }
  if (transitions.length === 0) return undefined;
  transitions.sort((a, b) => a.at - b.at);
  const unique = transitions.filter((t, i) => i === 0 || t.at !== transitions[i - 1]!.at);
  const location = zoneFromTzid(get(component, 'X-LIC-LOCATION')?.value ?? '');
  return {
    tzid,
    ...(location ? { location } : {}),
    names,
    transitions: unique,
  };
}

function rdates(props: ContentLine[]): Civil[] {
  return props
    .filter((p) => p.name === 'RDATE')
    .flatMap((p) => p.value.split(','))
    .flatMap((v) => parseIcalDateTime(v.split('/')[0] ?? '')?.civil ?? []);
}

/** Onsets from a yearly RRULE, the only kind VTIMEZONE rules use in practice. */
function expandRule(part: Component, start: Civil, from: number, budget: number): Civil[] {
  const rule = part.props.find((p) => p.name === 'RRULE')?.value;
  if (!rule) return [];
  const parts = new Map(
    rule.split(';').map((kv) => kv.toUpperCase().split('=') as [string, string]),
  );
  if (parts.get('FREQ') !== 'YEARLY') return [];
  const list = (key: string) => (parts.get(key) ?? '').split(',').filter(Boolean);
  const months = list('BYMONTH')
    .map(Number)
    .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
  const byDay = list('BYDAY').flatMap((d) => {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d);
    return m ? [{ n: Number(m[1] ?? 0), day: WEEKDAYS.indexOf(m[2]!) }] : [];
  });
  const monthDays = list('BYMONTHDAY').map(Number);
  const setPos = Number(parts.get('BYSETPOS') ?? 0);
  const interval = Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1);
  const count = Number(parts.get('COUNT') ?? Infinity) || Infinity;
  const untilValue = parseIcalDateTime(parts.get('UNTIL') ?? '');
  const until = untilValue
    ? civilToMs(untilValue.civil) - (untilValue.utc ? 0 : from * MINUTE_MS)
    : Infinity;
  const startMs = civilToMs(start);
  const out: Civil[] = [];
  for (let year = start.year; year <= LAST_YEAR && out.length < budget; year += interval) {
    for (const month of months.length > 0 ? months : [start.month]) {
      let days = candidateDays(year, month, byDay, monthDays, start.day);
      if (setPos) days = [days.at(setPos > 0 ? setPos - 1 : setPos) ?? 0].filter(Boolean);
      for (const day of days) {
        const onset = {
          year,
          month,
          day,
          hour: start.hour,
          minute: start.minute,
        };
        const ms = civilToMs(onset);
        if (ms < startMs) continue;
        if (ms - from * MINUTE_MS > until || out.length >= count) return out;
        out.push(onset);
      }
    }
  }
  return out;
}

function candidateDays(
  year: number,
  month: number,
  byDay: { n: number; day: number }[],
  monthDays: number[],
  fallback: number,
): number[] {
  if (month < 1 || month > 12) return [];
  const last = daysInMonth(year, month);
  const all = Array.from({ length: last }, (_, i) => i + 1);
  let days = monthDays.length
    ? monthDays.map((d) => (d < 0 ? last + d + 1 : d)).filter((d) => d >= 1 && d <= last)
    : byDay.length
      ? all
      : [fallback];
  if (byDay.length) {
    days = days.filter((d) =>
      byDay.some(({ n, day }) => {
        if (weekday(year, month, d) !== day) return false;
        if (n === 0) return true;
        return n > 0 ? Math.ceil(d / 7) === n : Math.ceil((last - d + 1) / 7) === -n;
      }),
    );
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

/** UTC offset (minutes) of a custom zone at an instant. */
export function customOffset(zone: CustomZone, ms: number): number {
  const list = zone.transitions;
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.at <= ms) [found, lo] = [mid, mid + 1];
    else hi = mid - 1;
  }
  return found < 0 ? list[0]!.from : list[found]!.to;
}

/** The instant (ms) of a wall-clock time (civil ms) in a custom zone. */
export function customWallToUtc(zone: CustomZone, wallMs: number): number {
  return wallToUtc(wallMs, (ms) => customOffset(zone, ms));
}

let allZones: string[] | undefined;

/**
 * An IANA zone with the same offsets as `zone` for a year either side of `around`, or
 * undefined. Prefers X-LIC-LOCATION, then zones whose city is named in the TZID or TZNAME,
 * then the Windows mapping targets, then every zone Intl knows.
 */
export function matchIanaZone(zone: CustomZone, around: number): string | undefined {
  const samples: number[] = [];
  for (let t = around - 400 * DAY_MS; t <= around + 400 * DAY_MS; t += 15 * DAY_MS) {
    samples.push(t);
  }
  for (const { at } of zone.transitions) {
    if (Math.abs(at - around) <= 400 * DAY_MS) samples.push(at - MINUTE_MS, at);
  }
  const expected = samples.map((t) => customOffset(zone, t));
  allZones ??= [
    ...Intl.supportedValuesOf('timeZone'),
    'UTC',
    ...Array.from({ length: 12 }, (_, i) => `Etc/GMT+${i + 1}`),
    ...Array.from({ length: 14 }, (_, i) => `Etc/GMT-${i + 1}`),
  ];
  const hint = [zone.tzid, ...zone.names].join(' ').toLowerCase().replace(/[_-]/g, ' ');
  const named = allZones.filter((z) => {
    const city = (z.split('/').at(-1) ?? '').toLowerCase().replace(/_/g, ' ');
    return city.length >= 4 && hint.includes(city);
  });
  const candidates = new Set([
    ...(zone.location ? [zone.location] : []),
    ...named,
    ...preferredZones(),
    ...allZones,
  ]);
  for (const candidate of candidates) {
    if (samples.every((t, i) => zoneOffset(candidate, t) === expected[i])) return candidate;
  }
  return undefined;
}

// Writing: Care Hub's own feeds name IANA zones, so each one gets a VTIMEZONE built from Intl.

/** TZID and TZNAME aren't TEXT values, so line breaks and other controls are removed. */
const clean = (value: string) => stripControls(value, false);

interface Transition {
  at: number;
  from: number;
  to: number;
}

/**
 * A VTIMEZONE for an IANA zone covering the given years. Transitions are found with Intl;
 * transitions that repeat yearly (same month, weekday, week and time) become one RRULE, and
 * the last rule is left open so later occurrences of a series stay right.
 */
export function writeVTimezone(zone: string, fromYear: number, toYear: number): string[] {
  const start = civilToMs({ year: fromYear, month: 1, day: 1, hour: 0, minute: 0 });
  const end = civilToMs({ year: toYear + 1, month: 1, day: 1, hour: 0, minute: 0 });
  const out = ['BEGIN:VTIMEZONE', `TZID:${clean(zone)}`];
  const transitions = findTransitions(zone, start, end);
  if (transitions.length === 0) {
    const offset = formatUtcOffset(zoneOffset(zone, start));
    out.push('BEGIN:STANDARD', `DTSTART:${formatIcalDateTime(msToCivil(start))}`);
    out.push(
      `TZOFFSETFROM:${offset}`,
      `TZOFFSETTO:${offset}`,
      `TZNAME:${zoneName(zone, start, 'short')}`,
    );
    out.push('END:STANDARD', 'END:VTIMEZONE');
    return out;
  }
  const groups: { key: string; items: Transition[]; local: Civil }[] = [];
  const open = new Map<string, (typeof groups)[number]>();
  for (const t of transitions) {
    const local = msToCivil(t.at + t.from * MINUTE_MS);
    const last = daysInMonth(local.year, local.month);
    const week = local.day + 7 > last ? -1 : Math.ceil(local.day / 7);
    const day = weekday(local.year, local.month, local.day);
    const key = [t.from, t.to, local.month, week, day, local.hour, local.minute].join(' ');
    const group = open.get(key);
    const previous = group?.items.at(-1);
    if (group && previous && msToCivil(previous.at).year === msToCivil(t.at).year - 1) {
      group.items.push(t);
    } else {
      const created = { key, items: [t], local };
      groups.push(created);
      open.set(key, created);
    }
  }
  for (const { key, items, local } of groups) {
    const [firstItem, lastItem] = [items[0]!, items.at(-1)!];
    const name = zoneName(zone, firstItem.at, 'long');
    const daylight =
      /daylight|summer/i.test(name) || (/^GMT/.test(name) && firstItem.to > firstItem.from);
    const kind = daylight ? 'DAYLIGHT' : 'STANDARD';
    out.push(`BEGIN:${kind}`, `TZOFFSETFROM:${formatUtcOffset(firstItem.from)}`);
    out.push(
      `TZOFFSETTO:${formatUtcOffset(firstItem.to)}`,
      `TZNAME:${zoneName(zone, firstItem.at, 'short')}`,
    );
    out.push(`DTSTART:${formatIcalDateTime(local)}`);
    if (items.length > 1) {
      const [, , month, week, day] = key.split(' ');
      const until =
        msToCivil(lastItem.at).year < toYear ? `;UNTIL=${formatIcalUtc(lastItem.at)}` : '';
      out.push(`RRULE:FREQ=YEARLY;BYMONTH=${month};BYDAY=${week}${WEEKDAYS[Number(day)]}${until}`);
    }
    out.push(`END:${kind}`);
  }
  out.push('END:VTIMEZONE');
  return out;
}

/** Offset changes in [start, end), found by daily samples and narrowed to the minute. */
function findTransitions(zone: string, start: number, end: number): Transition[] {
  const out: Transition[] = [];
  let previous = zoneOffset(zone, start);
  for (let t = start + DAY_MS; t < end; t += DAY_MS) {
    const offset = zoneOffset(zone, t);
    if (offset === previous) continue;
    let [lo, hi] = [t - DAY_MS, t];
    while (hi - lo > MINUTE_MS) {
      const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
      if (zoneOffset(zone, mid) === previous) lo = mid;
      else hi = mid;
    }
    out.push({ at: hi, from: previous, to: offset });
    previous = offset;
  }
  return out;
}

function zoneName(zone: string, at: number, style: 'short' | 'long'): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return clean(part?.value ?? zone);
}
