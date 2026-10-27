// Each person's notification settings (Messages, "Unread and notifications"; Settings →
// Notifications). They apply in every workspace; mute is per chat and lives in Messages.
import { z } from 'zod';

/**
 * What to notify about: all messages (the default); only direct messages, @mentions and notices;
 * or nothing.
 */
export const NOTIFY_ABOUT = ['all', 'mentions', 'nothing'] as const;
export type NotifyAbout = (typeof NOTIFY_ABOUT)[number];

export interface NotificationPreferences {
  notifyAbout: NotifyAbout;
  /** "Show message text in notifications" (on by default). Off: only who and what kind. */
  showText: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<NotificationPreferences> = Object.freeze({
  notifyAbout: 'all',
  showText: true,
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
