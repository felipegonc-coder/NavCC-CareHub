// What other features may use from reminders: Calendar's event reminders. See README.md.
export type { EventStart, Reminder, ReminderStatus, ReminderTarget, ReminderView } from './types';
export type { EventLookup, EventReminderInput } from './service';
export { REMINDER_LIMITS } from './domain/rules';
export {
  createEventReminder,
  deleteEventReminders,
  registerEventLookup,
  REMINDERS_CHANGED,
  syncEventReminders,
} from './service';
