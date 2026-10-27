// What other features may import from Reminders. Home's Reminders section uses the hook, and its
// See all goes to REMINDERS_PATH.
export { usePendingReminders, type PendingReminder } from './hooks';

/** The Reminders list. */
export const REMINDERS_PATH = '/reminders';
