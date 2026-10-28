import { DEFAULT_TIME_ZONE, type MeResponse } from '@carehub/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';

// Times show in the person's profile zone, never the browser's. Calendar days show as stored, and
// "today" is a day in Learning's zone (decision 0317).

/** The zone Learning's "today" is in: due soon and overdue compare due dates with today there. */
export const LEARNING_DAY_ZONE = 'America/Denver';

/** GET /api/auth/me's cache key. Every screen reads the same entry, so the profile loads once. */
export const meQueryKey = ['auth', 'me'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function supported(zone: string): boolean {
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone);
  } catch {
    return false; // A RangeError: the browser doesn't know this zone.
  }
}

const known = new Map<string, boolean>();

/** True for an IANA time zone name the browser knows, such as "America/Denver" or "UTC". */
export function isTimeZone(zone: string): boolean {
  let answer = known.get(zone);
  if (answer === undefined) {
    // Names start with a letter, so offsets such as "+05:00" don't count.
    answer = /^[A-Za-z][\w+/-]*$/.test(zone) && supported(zone);
    known.set(zone, answer);
  }
  return answer;
}

/**
 * The zone in a GET /api/auth/me reply: `user.timeZone` when the browser knows it, otherwise
 * America/Denver, the profile default.
 */
export function profileTimeZone(me: unknown): string {
  const zone = isRecord(me) && isRecord(me.user) ? me.user.timeZone : undefined;
  return typeof zone === 'string' && isTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
}

/**
 * The signed-in person's time zone, for showing times (completed, tried, last activity). It's
 * undefined while the profile loads, and America/Denver when the profile has no zone, has one the
 * browser doesn't know, or can't be loaded. `useProfileTimeZone() ?? LEARNING_DAY_ZONE` never waits.
 */
export function useProfileTimeZone(): string | undefined {
  const me = useQuery({
    queryKey: meQueryKey,
    queryFn: ({ signal }) => api.get<MeResponse>('/api/auth/me', { signal }),
    staleTime: Infinity,
  });
  return me.isPending ? undefined : profileTimeZone(me.data);
}
