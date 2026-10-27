import { describe, expect, it } from 'vitest';
import type { Action, Trigger } from './automation';
import { automationChanges, automationInput, automationProblems } from './validate';

const avery = '7f0c2b9e-3d4a-4c1e-9b8f-1a2b3c4d5e6f';
const now = new Date('2026-10-27T15:00:00.000Z'); // 9:00 AM in Denver
const weekdays: Trigger = {
  kind: 'schedule',
  schedule: { kind: 'weekdays', time: '09:00', timeZone: 'America/Denver', endDate: null },
};
const rowAdded: Trigger = { kind: 'rowAdded', databaseId: 'db-qa', includeImports: false };
const message = (overrides: Partial<Extract<Action, { kind: 'sendMessage' }>> = {}): Action => ({
  kind: 'sendMessage',
  recipients: [{ kind: 'person', userId: avery }],
  text: 'Good morning, {first name}. Stand-up is at 9:15.',
  pageIds: [],
  ...overrides,
});
const automation = (overrides: Partial<Parameters<typeof automationProblems>[0]> = {}) => ({
  enabled: true,
  trigger: weekdays,
  conditions: null,
  variables: [],
  actions: [message()],
  ...overrides,
});

describe('automationInput', () => {
  it('fills in the defaults and trims the name', () => {
    const parsed = automationInput.parse({
      name: '  Morning stand-up  ',
      trigger: weekdays,
      actions: [message()],
    });
    expect(parsed).toEqual({
      name: 'Morning stand-up',
      enabled: true,
      trigger: weekdays,
      conditions: null,
      variables: [],
      actions: [message()],
    });
  });

  it('words its errors for the editor', () => {
    const result = automationInput.safeParse({
      name: ' ',
      trigger: weekdays,
      actions: Array.from({ length: 11 }, () => message()),
    });
    expect(result.success).toBe(false);
    const issues = result.error?.issues.map(({ path, message }) => ({ path, message }));
    expect(issues).toEqual([
      { path: ['name'], message: 'Give it a name.' },
      { path: ['actions'], message: 'Add up to 10 actions.' },
    ]);
  });

  it('refuses kinds it doesn’t know and recipients that aren’t people', () => {
    expect(
      automationInput.safeParse({
        name: 'Escalations',
        trigger: { kind: 'propertyChanged', databaseId: 'db-qa' },
        actions: [message()],
      }).success,
    ).toBe(false);
    expect(
      automationInput.safeParse({
        name: 'Escalations',
        trigger: weekdays,
        actions: [message({ recipients: [{ kind: 'person', userId: 'riley' }] })],
      }).success,
    ).toBe(false);
  });
});

describe('automationChanges', () => {
  it('takes only the fields that change', () => {
    expect(automationChanges.parse({ enabled: false })).toEqual({ enabled: false });
    expect(automationChanges.safeParse({ actions: [] }).success).toBe(false);
  });
});

describe('automationProblems', () => {
  it('accepts a good automation', () => {
    expect(automationProblems(automation(), now)).toEqual([]);
    expect(
      automationProblems(
        automation({
          trigger: rowAdded,
          conditions: { property: 'team', is: 'Phoenix' },
          actions: [message({ recipients: [{ kind: 'personProperty', propertyId: 'agent' }] })],
        }),
        now,
      ),
    ).toEqual([]);
  });

  it('names the field of each problem', () => {
    const problems = automationProblems(
      automation({
        conditions: { property: 'team', is: 'Phoenix' },
        variables: [
          { name: 'Due', formula: 'today()' },
          { name: 'due', formula: 'now()' },
        ],
        actions: [
          message({ recipients: [], text: '  ' }),
          message({ recipients: [{ kind: 'personProperty', propertyId: 'agent' }] }),
          {
            kind: 'addRow',
            databaseId: 'db-escalations',
            templateId: null,
            values: [{ propertyId: 'raised-by', value: { kind: 'triggeredBy' } }],
          },
        ],
      }),
      now,
    );
    expect(problems).toEqual([
      { path: ['conditions'], message: 'Conditions need a database trigger.' },
      { path: ['variables', 1, 'name'], message: 'Each variable needs its own name.' },
      { path: ['actions', 0, 'recipients'], message: 'Pick at least one recipient.' },
      { path: ['actions', 0, 'text'], message: 'Write a message.' },
      {
        path: ['actions', 1, 'recipients'],
        message: 'A Person property needs a database trigger.',
      },
      {
        path: ['actions', 2, 'values', 0, 'value'],
        message: 'This value needs a database trigger.',
      },
    ]);
  });

  it('checks the schedule, but lets a switched-off automation keep a time that has passed', () => {
    const once: Trigger = {
      kind: 'schedule',
      schedule: { kind: 'once', date: '2026-10-26', time: '09:00', timeZone: 'America/Denver' },
    };
    expect(automationProblems(automation({ trigger: once }), now)).toEqual([
      { path: ['trigger', 'schedule', 'time'], message: 'That time has already passed.' },
    ]);
    expect(automationProblems(automation({ trigger: once, enabled: false }), now)).toEqual([]);
    const offGrid: Trigger = {
      kind: 'schedule',
      schedule: { kind: 'once', date: '2026-10-28', time: '09:10', timeZone: 'America/Denver' },
    };
    expect(automationProblems(automation({ trigger: offGrid, enabled: false }), now)).toEqual([
      {
        path: ['trigger', 'schedule', 'time'],
        message: 'Pick a time on the quarter hour, like 9:00 or 9:15.',
      },
    ]);
  });

  it('allows a message with only a page card', () => {
    expect(
      automationProblems(
        automation({ actions: [message({ text: '', pageIds: ['page-1'] })] }),
        now,
      ),
    ).toEqual([]);
  });
});
