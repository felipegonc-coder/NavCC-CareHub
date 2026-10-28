import { z } from 'zod';
import { timeZoneSchema } from './values';

/**
 * Each person's Calendar settings (Calendar spec, section 2). Week start and 24-hour time are
 * profile settings shared with the rest of Care Hub (`user.weekStart`, `user.use24h`, changed
 * with `PATCH /api/auth/profile`), so they aren't here.
 */
export const calendarSettingsSchema = z.object({
  hideWeekends: z.boolean(),
  /** Minutes for a new event made by clicking a time. */
  defaultLength: z.union([z.literal(30), z.literal(60)]),
  /** Single-key shortcuts such as T, D, W and M. */
  shortcuts: z.boolean(),
  /** A second column of hours in Day and Week, with a short label such as "Lisbon". */
  secondTimeZone: z
    .object({ timeZone: timeZoneSchema, label: z.string().trim().min(1).max(30) })
    .nullable(),
  weekNumbers: z.boolean(),
  hideDeclined: z.boolean(),
  /** Minutes before the start, for the new timed events this person makes (CA-21). */
  defaultReminder: z.number().int().min(0).max(40_320).nullable(),
});
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>;

/** What someone who never changed anything gets. */
export const DEFAULT_SETTINGS: CalendarSettings = {
  hideWeekends: false,
  defaultLength: 60,
  shortcuts: true,
  secondTimeZone: null,
  weekNumbers: false,
  hideDeclined: false,
  defaultReminder: null,
};

/** `GET /api/calendar/settings`, and the answer to a change. */
export const settingsResponseSchema = z.object({ settings: calendarSettingsSchema });
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

/** `PATCH /api/calendar/settings`: only the settings that changed. */
export const settingsPatchSchema = z
  .strictObject(calendarSettingsSchema.shape)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Send at least one change.');
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
