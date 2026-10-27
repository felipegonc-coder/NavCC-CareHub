import { describe, expect, it } from 'vitest';
import { DEFAULT_TIME_PREFS } from '@carehub/team-time';
import type { Action, Trigger } from './automation';
import {
  describeAction,
  describeRecipients,
  describeTrigger,
  joinWords,
  readBack,
  type AutomationNames,
} from './describe';

const known: Record<string, string> = {
  avery: 'Avery Lin',
  riley: 'Riley Chen',
  agent: 'Agent',
  lead: 'Team lead',
  qa: 'QA reviews',
  tickets: 'Tickets',
  intake: 'Client intake',
  teamLead: 'Team lead',
  followUp: 'Follow-up',
};
const lookUp = (id: string) => known[id];
const names: AutomationNames = {
  person: lookUp,
  role: lookUp,
  database: lookUp,
  form: lookUp,
  property: lookUp,
  template: lookUp,
};
const nobody: AutomationNames = {
  person: () => undefined,
  role: () => undefined,
  database: () => undefined,
  form: () => undefined,
  property: () => undefined,
  template: () => undefined,
};
const prefs = DEFAULT_TIME_PREFS;

const weekdays: Trigger = {
  kind: 'schedule',
  schedule: { kind: 'weekdays', time: '09:00', timeZone: 'America/Denver', endDate: null },
};
const rowAdded: Trigger = { kind: 'rowAdded', databaseId: 'qa', includeImports: false };
const formResponse: Trigger = { kind: 'formResponse', databaseId: 'tickets', formId: 'intake' };

const message = (recipients: Extract<Action, { kind: 'sendMessage' }>['recipients']): Action => ({
  kind: 'sendMessage',
  recipients,
  text: 'Morning {first name}!',
  pageIds: [],
});

describe('joinWords', () => {
  it('joins with commas and a final "and"', () => {
    expect(joinWords([])).toBe('');
    expect(joinWords(['A'])).toBe('A');
    expect(joinWords(['A', 'B'])).toBe('A and B');
    expect(joinWords(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('describeTrigger', () => {
  it('says when it runs, as in the list', () => {
    expect(describeTrigger(weekdays, names, prefs)).toBe('Weekdays at 9:00 AM');
    expect(describeTrigger(rowAdded, names, prefs)).toBe('When a row is added to QA reviews');
    expect(describeTrigger(formResponse, names, prefs)).toBe(
      'When a response arrives through Client intake',
    );
  });

  it('reads without the names it doesn’t know', () => {
    expect(describeTrigger(rowAdded, nobody, prefs)).toBe('When a row is added to a database');
  });
});

describe('describeRecipients', () => {
  it('names people, then roles, then the row’s people', () => {
    expect(
      describeRecipients(
        [
          { kind: 'personProperty', propertyId: 'teamLead' },
          { kind: 'role', roleId: 'agent' },
          { kind: 'person', userId: 'avery' },
          { kind: 'role', roleId: 'lead' },
        ],
        names,
      ),
    ).toBe("Avery Lin, the roles Agent and Team lead and the row's Team lead");
  });

  it('says everyone when everyone is picked', () => {
    expect(
      describeRecipients([{ kind: 'role', roleId: 'agent' }, { kind: 'everyone' }], names),
    ).toBe('everyone');
  });
});

describe('describeAction', () => {
  it('describes each kind of action', () => {
    expect(describeAction(message([{ kind: 'role', roleId: 'agent' }]), names)).toBe(
      'message the role Agent',
    );
    expect(describeAction(message([]), names)).toBe('send a message');
    const addRow: Action = { kind: 'addRow', databaseId: 'tickets', templateId: null, values: [] };
    expect(describeAction(addRow, names)).toBe('add a row to Tickets');
    expect(describeAction({ ...addRow, templateId: 'followUp' }, names)).toBe(
      'add a row to Tickets from the template Follow-up',
    );
  });
});

describe('readBack', () => {
  it('reads the automation back in one sentence', () => {
    expect(
      readBack(
        {
          trigger: rowAdded,
          actions: [
            message([{ kind: 'personProperty', propertyId: 'teamLead' }]),
            { kind: 'addRow', databaseId: 'tickets', templateId: null, values: [] },
          ],
        },
        names,
        prefs,
      ),
    ).toBe(
      "When a row is added to QA reviews, message the row's Team lead and add a row to Tickets.",
    );
    expect(
      readBack(
        { trigger: weekdays, actions: [message([{ kind: 'role', roleId: 'agent' }])] },
        names,
        prefs,
      ),
    ).toBe('Weekdays at 9:00 AM, message the role Agent.');
  });

  it('says when nothing happens yet', () => {
    expect(readBack({ trigger: weekdays, actions: [] }, names, prefs)).toBe(
      'Weekdays at 9:00 AM, nothing happens yet.',
    );
  });
});
