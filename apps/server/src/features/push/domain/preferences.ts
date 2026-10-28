// Each person's notification settings (Messages, "Unread and notifications"; Settings →
// Notifications). They apply in every workspace; mute is per chat and lives in Messages.
import { DEFAULT_TIME_ZONE } from '@carehub/shared';
import { addDays, combine, isValidTimeZone, toInstant, todayIn } from '@carehub/team-time';
import { z } from 'zod';

/**
 * What to notify about: all messages (the default); only direct messages, @mentions and notices;
 * or nothing.
 */
export const NOTIFY_ABOUT = ['all', 'mentions', 'nothing'] as const;
export type NotifyAbout = (typeof NOTIFY_ABOUT)[number];

/**
 * "Pause notifications" (Settings and members spec, 3.3). Nothing notifies the person meanwhile;
 * notices still arrive in the 🔔 chat, quietly.
 */
export interface NotificationPause {
  /** When it ends by itself; null when it lasts until the person turns notifications back on. */
  until: Date | null;
}

export interface NotificationPreferences {
  notifyAbout: NotifyAbout;
  /** "Show message text in notifications" (on by default). Off: only who and what kind. */
  showText: boolean;
  /** Null when not paused. A pause may have ended already: `activePause` says. */
  pause: NotificationPause | null;
}

export const DEFAULT_PREFERENCES: Readonly<NotificationPreferences> = Object.freeze({
  notifyAbout: 'all',
  showText: true,
  pause: null,
});

/** The body of PATCH /api/push/preferences: one setting or both. */
export const preferencesPatch = z.strictObject({
  notifyAbout: z.enum(NOTIFY_ABOUT).optional(),
  showText: z.boolean().optional(),
});

/** Only the settings that are given. */
export function changedPreferences(
  patch: z.infer<typeof preferencesPatch>,
): Partial<NotificationPreferences> {
  const changes: Partial<NotificationPreferences> = {};
  if (patch.notifyAbout !== undefined) changes.notifyAbout = patch.notifyAbout;
  if (patch.showText !== undefined) changes.showText = patch.showText;
  return changes;
}

/** How a pause ends: in 1 hour, tomorrow at 8:00 AM, or when the person turns it off. */
export const PAUSE_ENDS = ['in_an_hour', 'tomorrow_8am', 'when_turned_on'] as const;
export type PauseEnds = (typeof PAUSE_ENDS)[number];

/** The body of PUT /api/push/pause. */
export const pauseBody = z.strictObject({ ends: z.enum(PAUSE_ENDS) });

const HOUR_MS = 60 * 60 * 1000;

/**
 * A pause that starts at `now`. Tomorrow at 8:00 AM is in the person's time zone, or in
 * America/Denver when theirs isn't one `Intl` knows.
 */
export function pauseFrom(ends: PauseEnds, now: Date, timeZone: string): NotificationPause {
  switch (ends) {
    case 'in_an_hour':
      return { until: new Date(now.getTime() + HOUR_MS) };
    case 'tomorrow_8am': {
      const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
      return { until: toInstant(combine(addDays(todayIn(zone, now), 1), '08:00'), zone) };
    }
    case 'when_turned_on':
      return { until: null };
  }
}

/** The pause still on at `now`, or null. */
export function activePause(pause: NotificationPause | null, now: Date): NotificationPause | null {
  return pause && (pause.until === null || pause.until > now) ? pause : null;
}
