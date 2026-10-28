// Browser tests serve stand-in calendars from this computer over http, which calendar links
// can't otherwise use. CAREHUB_TEST_CALENDAR_ORIGINS lists their origins; it's read only with
// CAREHUB_TEST_HOOKS=1, which only browser-test servers set (decision 0007, section 2.3).

import { z } from 'zod';
import { readSettings } from '../../../core/settings';
import type { ReadSettingsOptions } from '../../../core/settings';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Whether `entry` is exactly an http loopback origin with a port, like http://127.0.0.1:4598. */
export function isTestOrigin(entry: string): boolean {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return false;
  }
  return (
    url.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.port !== '' &&
    url.origin === entry
  );
}

const hooksSettings = z.object({
  CAREHUB_TEST_HOOKS: z.enum(['0', '1']).optional(),
});

const originSettings = z.object({
  /** Comma-separated, for example "http://127.0.0.1:4598,http://[::1]:4598". */
  CAREHUB_TEST_CALENDAR_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    )
    .refine(
      (entries) => entries.length > 0 && entries.every(isTestOrigin),
      'give only http loopback origins with a port, like http://127.0.0.1:4598, separated by commas',
    )
    .optional(),
});

/**
 * The origins whose calendar links may use http and this computer's loopback addresses (the
 * `testOrigins` option of fetchCalendarLink). Read once, when the calendar feature starts. Empty
 * unless CAREHUB_TEST_HOOKS=1. A list with anything else in it is refused as a whole: it counts
 * as unset, with a warning that doesn't show it.
 */
export function readTestCalendarOrigins(options: ReadSettingsOptions = {}): string[] {
  if (readSettings(hooksSettings, options).CAREHUB_TEST_HOOKS !== '1') {
    if ((options.env ?? process.env).CAREHUB_TEST_CALENDAR_ORIGINS) {
      (options.log ?? console).warn(
        "CAREHUB_TEST_CALENDAR_ORIGINS is ignored, because CAREHUB_TEST_HOOKS isn't 1.",
      );
    }
    return [];
  }
  return [...new Set(readSettings(originSettings, options).CAREHUB_TEST_CALENDAR_ORIGINS ?? [])];
}
