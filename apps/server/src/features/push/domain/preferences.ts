// Each person's notification settings (Messages, "Unread and notifications"; Settings →
// Notifications). They apply in every workspace; mute is per chat and lives in Messages.
import { z } from 'zod';

/**
 * What to notify about: all messages (the default); only direct messages, @mentions and notices;
 * or nothing.
 */
export const NOTIFY_ABOUT = ['all', 'mentions', 'nothing'] as const;
export type NotifyAbout = (typeof NOTIFY_ABOUT)[number];

/**
 * "Pause notifications" (Settings and members spec, 3.3): for 1 hour, until tomorrow 8:00 AM, or
 * until turned back on. Nothing notifies meanwhile; notices still arrive in the 🔔 chat, quietly.
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

/** The longest pause with an end, so a wrong clock can't pause notifications for months. */
export const MAX_PAUSE_MS = 7 * 24 * 60 * 60 * 1000;
export const PAUSE_END_MESSAGE = 'Choose a time in the next 7 days.';

/**
 * The body of PATCH /api/push/preferences: any of the settings. `pause: { until }` pauses (until
 * null: until turned back on), and `pause: null` turns notifications back on.
 */
export const preferencesPatch = z.strictObject({
  notifyAbout: z.enum(NOTIFY_ABOUT).optional(),
  showText: z.boolean().optional(),
  pause: z
    .strictObject({ until: z.iso.datetime({ offset: true }).nullable() })
    .nullable()
    .optional(),
});

/** Only the settings that are given. */
export function changedPreferences(
  patch: z.infer<typeof preferencesPatch>,
): Partial<NotificationPreferences> {
  const changes: Partial<NotificationPreferences> = {};
  if (patch.notifyAbout !== undefined) changes.notifyAbout = patch.notifyAbout;
  if (patch.showText !== undefined) changes.showText = patch.showText;
  if (patch.pause !== undefined) {
    const until = patch.pause?.until;
    changes.pause = patch.pause && { until: until ? new Date(until) : null };
  }
  return changes;
}

/** False for a pause that ends before `now` or more than 7 days after it. */
export function canPause(pause: NotificationPause, now: Date): boolean {
  if (pause.until === null) return true;
  const left = pause.until.getTime() - now.getTime();
  return left > 0 && left <= MAX_PAUSE_MS;
}

/** The pause still on at `now`, or null. */
export function activePause(pause: NotificationPause | null, now: Date): NotificationPause | null {
  return pause && (pause.until === null || pause.until > now) ? pause : null;
}
