/**
 * Automations in plain words (Automations spec, section 2): the list's trigger column ("Weekdays
 * at 9:00 AM", "When a row is added to QA reviews") and the sentence at the top of the editor
 * that reads the automation back ("When a row is added to QA reviews, message the row's Team
 * lead."). The caller passes the names it knows; what it can't name reads as "a database".
 */
import type { TimePrefs } from '@carehub/team-time';
import type { Action, Recipient, Trigger } from './automation';
import { describeSchedule } from './schedule';

/** Names for the IDs in an automation, or undefined when the reader doesn't know one. */
export interface AutomationNames {
  person(userId: string): string | undefined;
  role(roleId: string): string | undefined;
  database(databaseId: string): string | undefined;
  form(formId: string): string | undefined;
  /** A property of the database the trigger watches. */
  property(propertyId: string): string | undefined;
  template(templateId: string): string | undefined;
}

/** 'A', 'A and B', 'A, B and C'. */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** The list's trigger column: 'Weekdays at 9:00 AM', 'When a row is added to QA reviews'. */
export function describeTrigger(
  trigger: Trigger,
  names: AutomationNames,
  prefs: TimePrefs,
): string {
  switch (trigger.kind) {
    case 'schedule':
      return describeSchedule(trigger.schedule, prefs);
    case 'rowAdded':
      return `When a row is added to ${names.database(trigger.databaseId) ?? 'a database'}`;
    case 'formResponse':
      return `When a response arrives through ${names.form(trigger.formId) ?? 'a form'}`;
  }
}

/** 'everyone', or 'Avery Lin, the role Agent and the row's Team lead'. */
export function describeRecipients(
  recipients: readonly Recipient[],
  names: AutomationNames,
): string {
  if (recipients.some((recipient) => recipient.kind === 'everyone')) return 'everyone';
  const people = recipients.flatMap((r) =>
    r.kind === 'person' ? [names.person(r.userId) ?? 'someone who left'] : [],
  );
  const roles = recipients.flatMap((r) =>
    r.kind === 'role' ? [names.role(r.roleId) ?? 'a role'] : [],
  );
  const properties = recipients.flatMap((r) =>
    r.kind === 'personProperty' ? [`the row's ${names.property(r.propertyId) ?? 'person'}`] : [],
  );
  const roleWords =
    roles.length === 0 ? [] : [`the role${roles.length > 1 ? 's' : ''} ${joinWords(roles)}`];
  return joinWords([...people, ...roleWords, ...properties]);
}

/** One action as the end of a sentence: 'message the role Agent', 'add a row to Tickets'. */
export function describeAction(action: Action, names: AutomationNames): string {
  switch (action.kind) {
    case 'sendMessage': {
      const to = describeRecipients(action.recipients, names);
      return to === '' ? 'send a message' : `message ${to}`;
    }
    case 'addRow': {
      const row = `add a row to ${names.database(action.databaseId) ?? 'a database'}`;
      if (action.templateId === null) return row;
      return `${row} from the template ${names.template(action.templateId) ?? 'that was deleted'}`;
    }
  }
}

/** The editor's readback: 'Weekdays at 9:00 AM, message the role Agent.' */
export function readBack(
  automation: { trigger: Trigger; actions: readonly Action[] },
  names: AutomationNames,
  prefs: TimePrefs,
): string {
  const when = describeTrigger(automation.trigger, names, prefs);
  const actions = automation.actions.map((action) => describeAction(action, names));
  return `${when}, ${actions.length === 0 ? 'nothing happens yet' : joinWords(actions)}.`;
}
