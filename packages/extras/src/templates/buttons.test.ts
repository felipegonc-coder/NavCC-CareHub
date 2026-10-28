import { describe, expect, it } from 'vitest';
import {
  BUTTON_MESSAGES,
  buttonSettingsSchema,
  describeButton,
  fillBlocks,
  fillMessage,
  nextConfirm,
  resolveRowValues,
  settingsProblem,
  type ButtonAction,
  type ButtonSettings,
  type PressContext,
} from './buttons';

const TICKETS = '6f1d2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b';
const PAGE = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const AVERY = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const settings = (actions: ButtonAction[]): ButtonSettings => ({
  label: 'New ticket',
  icon: '🎫',
  color: 'blue',
  who: 'editors',
  actions,
});

const addTicket: ButtonAction = {
  kind: 'add_row',
  databaseId: TICKETS,
  templateId: null,
  values: {},
  names: { target: 'Tickets', values: ['Status New', 'Assignee as the person who pressed it'] },
};

const ctx: PressContext = {
  userId: AVERY,
  name: 'Avery Lin',
  timeZone: 'America/Denver',
  use24h: false,
  page: { id: PAGE, title: 'QA desk' },
  now: new Date('2026-10-26T15:05:00.000Z'),
};

describe('the plain sentence', () => {
  it("reads like the spec's example", () => {
    const open: ButtonAction = { kind: 'open_page', pageId: null, openIn: 'this_tab' };
    expect(describeButton(settings([addTicket, open]))).toBe(
      'When pressed: add a row to Tickets with Status New and Assignee as the person who pressed it, then open it.',
    );
  });

  it('lists every step in order', () => {
    const blocks = [{ type: 'paragraph' }, { type: 'paragraph' }, { type: 'taskList' }];
    const sentence = describeButton(
      settings([
        { kind: 'insert_blocks', where: 'below', blocks },
        { ...addTicket, names: { target: 'Tickets' } },
        { kind: 'confirm', title: 'Send it?', message: '', confirmLabel: 'Send' },
        {
          kind: 'send_message',
          to: { userIds: [AVERY], groupIds: [], roleIds: [], everyone: false },
          message: 'New ticket',
          card: 'new_row',
        },
        { kind: 'open_link', url: 'https://status.example.org/today' },
      ]),
    );
    expect(sentence).toBe(
      'When pressed: insert 3 blocks below, add a row to Tickets, ask for confirmation, send a message to 1 person, then open status.example.org in a new tab.',
    );
  });

  it('is empty without actions', () => {
    expect(describeButton(settings([]))).toBe('');
  });
});

describe('saving', () => {
  it('only lets Admins send to Everyone or to roles', () => {
    const everyone: ButtonAction = {
      kind: 'send_message',
      to: { userIds: [], groupIds: [], roleIds: [], everyone: true },
      message: 'Huddle in 5',
      card: null,
    };
    expect(settingsProblem(settings([everyone]), { isAdmin: false })).toBe(
      BUTTON_MESSAGES.adminsOnly,
    );
    expect(settingsProblem(settings([everyone]), { isAdmin: true })).toBeNull();
  });

  it('opens the new row only after an Add a row step', () => {
    const open: ButtonAction = { kind: 'open_page', pageId: null, openIn: 'new_tab' };
    expect(settingsProblem(settings([open]), { isAdmin: true })).toBe(BUTTON_MESSAGES.noEarlierRow);
    expect(settingsProblem(settings([addTicket, open]), { isAdmin: false })).toBeNull();
  });

  it('refuses links that are not http or https, more than 10 steps and more than 50 people', () => {
    const base = { label: 'Go', actions: [] as unknown[] };
    const link = (url: string) => ({ ...base, actions: [{ kind: 'open_link', url }] });
    expect(buttonSettingsSchema.safeParse(link('javascript:alert(1)')).success).toBe(false);
    expect(buttonSettingsSchema.safeParse(link('https://example.org')).success).toBe(true);
    const confirm = { kind: 'confirm', title: 'Sure?' };
    expect(
      buttonSettingsSchema.safeParse({ ...base, actions: Array(11).fill(confirm) }).success,
    ).toBe(false);
    const people = Array.from(
      { length: 51 },
      (_, i) => `1a2b3c4d-5e6f-4a7b-8c9d-${String(i).padStart(12, '0')}`,
    );
    const message = {
      kind: 'send_message',
      to: { userIds: people },
      message: 'Hi',
    };
    const parsed = buttonSettingsSchema.safeParse({ ...base, actions: [message] });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain(BUTTON_MESSAGES.tooManyPeople);
  });

  it('fills in defaults', () => {
    const parsed = buttonSettingsSchema.parse({ label: ' Start shift ', actions: [] });
    expect(parsed).toEqual({
      label: 'Start shift',
      icon: null,
      color: 'default',
      who: 'editors',
      actions: [],
    });
  });
});

describe('pressing', () => {
  it('fills in variable chips: dates and names as text, This page as a link', () => {
    const chip = (kind: string, offsetDays = 0) => ({
      type: 'templateVariable',
      attrs: { kind, offsetDays },
    });
    const blocks = fillBlocks(
      [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Due ' },
            chip('today', 3),
            { type: 'text', text: ' by ' },
            chip('me'),
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [chip('this_page')] }] },
          ],
        },
      ],
      ctx,
    );
    expect(blocks[0]?.content).toEqual([
      { type: 'text', text: 'Due ' },
      { type: 'text', text: 'Oct 29, 2026' },
      { type: 'text', text: ' by ' },
      { type: 'text', text: 'Avery Lin' },
    ]);
    expect(blocks[1]?.content?.[0]?.content?.[0]?.content).toEqual([
      { type: 'text', text: 'QA desk', marks: [{ type: 'link', attrs: { href: `/p/${PAGE}` } }] },
    ]);
  });

  it('fills in a message', () => {
    expect(fillMessage('{{me}} opened a ticket on {{today}} from {{this_page}}.', ctx)).toBe(
      'Avery Lin opened a ticket on Oct 26, 2026 from QA desk.',
    );
  });

  it('resolves Today, Me and This page in row values', () => {
    const values = resolveRowValues(
      {
        due: { dynamic: 'today', offsetDays: 1 },
        assignee: ['me'],
        project: ['this_page'],
        status: 'opt-new',
      },
      ctx,
    );
    expect(values).toEqual({
      due: { start: '2026-10-27', end: null, hasTime: false },
      assignee: [AVERY],
      project: [PAGE],
      status: 'opt-new',
    });
  });

  it('finds the next confirmation', () => {
    const confirm: ButtonAction = {
      kind: 'confirm',
      title: 'Sure?',
      message: '',
      confirmLabel: 'Go',
    };
    const actions = [addTicket, confirm, addTicket];
    expect(nextConfirm(actions, 0)).toBe(1);
    expect(nextConfirm(actions, 2)).toBe(-1);
  });
});
