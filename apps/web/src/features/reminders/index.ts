// What other features may import from Reminders. Home's Reminders section uses the hook, and its
// See all goes to REMINDERS_PATH. Calendar's event panel and Search open Remind me.
export type { PendingReminder } from './api';
export type { RemindMeTarget } from './choices';
export { usePendingReminders } from './hooks';
export { openRemindMe } from './remindMe';

/** The Reminders list. */
export const REMINDERS_PATH = '/reminders';
