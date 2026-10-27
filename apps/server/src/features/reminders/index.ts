// What other features may use from reminders: Calendar's event reminders. See README.md.
export type { EventStart, Reminder, ReminderStatus, ReminderTarget } from './types';
export type { EventReminderInput } from './service';
export { REMINDER_LIMITS } from './domain/rules';
export {
  createEventReminder,
  deleteEventReminders,
  REMINDERS_CHANGED,
  syncEventReminders,
} from './service';
