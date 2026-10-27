// The date range and filters live in the address (?days=30, ?from=…&to=…, ?person=…, ?space=…),
// so a reload or a shared link shows the same numbers.
import type { OverviewQuery } from './api';

export const PRESETS = ['7', '30', '90'] as const;
export type Preset = (typeof PRESETS)[number];
export type RangeChoice = Preset | 'custom';

/** The last 7 days, with today, unless the person picks another range (Analytics spec, section 2). */
export const DEFAULT_PRESET: Preset = '7';

export const RANGE_LABELS: Record<RangeChoice, string> = {
  '7': 'Last 7 days',
  '30': 'Last 30 days',
  '90': 'Last 90 days',
  custom: 'Custom range',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isPreset = (value: string | null): value is Preset => PRESETS.some((days) => days === value);
const isDay = (value: string | null): value is string => value !== null && DAY.test(value);
const isId = (value: string | null): value is string => value !== null && ID.test(value);

/** What the address asks for. Anything unreadable is left out, so the defaults apply. */
export function readQuery(params: URLSearchParams): OverviewQuery {
  const query: OverviewQuery = {};
  const [from, to, days] = [params.get('from'), params.get('to'), params.get('days')];
  if (isDay(from) && isDay(to)) Object.assign(query, { from, to });
  else if (isPreset(days) && days !== DEFAULT_PRESET) query.days = days;
  const [person, space] = [params.get('person'), params.get('space')];
  if (isId(person)) query.person = person;
  if (isId(space)) query.space = space;
  return query;
}

/** The address for a query. The default range isn't written out. */
export function writeQuery(query: OverviewQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.from && query.to) {
    params.set('from', query.from);
    params.set('to', query.to);
  } else if (query.days && query.days !== DEFAULT_PRESET) {
    params.set('days', query.days);
  }
  if (query.person) params.set('person', query.person);
  if (query.space) params.set('space', query.space);
  return params;
}

export function rangeChoice(query: OverviewQuery): RangeChoice {
  return query.from && query.to ? 'custom' : (query.days ?? DEFAULT_PRESET);
}

/** Why a custom range can't be shown, or null when it can. */
export function customRangeProblem(
  from: string,
  to: string,
  limits: { keptFrom: string; today: string },
): string | null {
  if (!isDay(from) || !isDay(to)) return 'Choose a start date and an end date.';
  if (from > to) return 'Choose a start date on or before the end date.';
  if (from < limits.keptFrom || to > limits.today) {
    return 'Choose dates within the last year, up to today.';
  }
  return null;
}
