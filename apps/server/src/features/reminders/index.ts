// What other features may use from reminders: Calendar's event reminders and title lookups.
export type { EventStart, Reminder, ReminderStatus, ReminderTarget, ReminderView } from './types';
export type { EventLookup, EventRemap, EventReminderInput, TitleLookup } from './service';
export { REMINDER_LIMITS } from './domain/rules';
export {
  createEventReminder,
  deleteEventReminders,
  registerEventLookup,
  registerTitleLookup,
  remapEventReminders,
  REMINDERS_CHANGED,
  syncEventReminders,
} from './service';
