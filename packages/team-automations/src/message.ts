/**
 * Send a message's fill-ins (Automations spec, section 3: Message), shared by the server, which
 * fills them in for each recipient, and the editor, which offers them. {first name} is the
 * recipient's and {date} the run's day ("Monday, Oct 26") in the automation's time zone. The
 * row's properties and variables join them with the database triggers.
 */
import { formatDate, todayIn } from '@carehub/team-time';
import type { Trigger } from './automation';

/** Care Hub's default time zone: {date} uses it when the trigger has none of its own. */
export const DEFAULT_TIME_ZONE = 'America/Denver';

/** The fill-ins the editor offers, as they're typed in the text. */
export const FILL_INS = ['{first name}', '{date}'] as const;

export interface FillInValues {
  /** The recipient's first name. */
  firstName: string;
  /** The run's day, such as 'Monday, Oct 26'. */
  date: string;
}

// Any case, so "{First name}" works too.
const FILL_IN = /\{(first name|date)\}/gi;

/** The text with its fill-ins filled in. Anything else in braces stays as typed. */
export function fillIn(text: string, values: FillInValues): string {
  return text.replace(FILL_IN, (_match, name: string) =>
    name.toLowerCase() === 'date' ? values.date : values.firstName,
  );
}

/** The first word of a name: 'Avery' for 'Avery Lin'. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** The time zone {date} uses: the schedule's, or Care Hub's default for the other triggers. */
export function messageTimeZone(trigger: Trigger): string {
  return trigger.kind === 'schedule' ? trigger.schedule.timeZone : DEFAULT_TIME_ZONE;
}

/** {date}: the day of `at` in the time zone, such as 'Monday, Oct 26'. */
export function fillInDate(at: Date, timeZone: string): string {
  return formatDate(todayIn(timeZone, at), { weekday: 'long', year: false });
}
