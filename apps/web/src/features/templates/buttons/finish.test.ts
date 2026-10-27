import { BUTTON_MESSAGES, type ButtonAction } from '@carehub/extras/templates/buttons';
import { describe, expect, it } from 'vitest';
import { finishSettings, type ButtonDraft } from './finish';
import { ID, OTHER_PAGE_ID, TICKETS, TICKETS_ID } from './fixtures';

const metaOf = (databaseId: string) => (databaseId === TICKETS_ID ? TICKETS : undefined);
const draft = (actions: ButtonAction[]): ButtonDraft => ({
  label: 'Start intake',
  icon: ' 🚀 ',
  color: 'blue',
  who: 'viewers',
  actions,
});
const nobody = { userIds: [], groupIds: [], roleIds: [], everyone: false };

describe('finishSettings', () => {
  it('saves the steps with exact numbers and the names the sentence uses', () => {
    const result = finishSettings(
      draft([
        {
          kind: 'add_row',
          databaseId: TICKETS_ID,
          templateId: ID.intake,
          values: {
            [ID.status]: ID.new,
            [ID.hours]: ' 2.50 ',
            [ID.due]: { dynamic: 'today', offsetDays: 3 },
            [ID.owner]: ['me'],
          },
        },
        { kind: 'open_page', pageId: null, openIn: 'this_tab' },
      ]),
      metaOf,
    );
    expect(result).toEqual({
      settings: {
        label: 'Start intake',
        icon: '🚀',
        color: 'blue',
        who: 'viewers',
        actions: [
          {
            kind: 'add_row',
            databaseId: TICKETS_ID,
            templateId: ID.intake,
            values: {
              [ID.status]: ID.new,
              [ID.hours]: '2.5',
              [ID.due]: { dynamic: 'today', offsetDays: 3 },
              [ID.owner]: ['me'],
            },
            names: {
              target: 'Tickets',
              template: 'Intake',
              values: [
                'Status New',
                'Due Today + 3 days',
                'Owner as the person who pressed it',
                'Hours 2.5',
              ],
            },
          },
          { kind: 'open_page', pageId: null, openIn: 'this_tab' },
        ],
      },
    });
  });

  it('keeps the values as they are when the database isn’t loaded', () => {
    const edit: ButtonAction = {
      kind: 'edit_rows',
      databaseId: TICKETS_ID,
      filter: null,
      values: { [ID.status]: ID.done },
    };
    expect(finishSettings(draft([edit]), () => undefined)).toEqual({
      settings: { ...draft([edit]), icon: '🚀' },
    });
  });

  it.each([
    [{ kind: 'insert_blocks', where: 'below', blocks: [] }, 'Add the blocks to insert.'],
    [
      { kind: 'add_row', databaseId: '', templateId: null, values: {} },
      'Paste the link to a database.',
    ],
    [
      { kind: 'add_row', databaseId: TICKETS_ID, templateId: null, values: { [ID.hours]: 'lots' } },
      'Hours needs a number.',
    ],
    [
      { kind: 'add_row', databaseId: TICKETS_ID, templateId: null, values: { [ID.status]: null } },
      'Choose a value for Status.',
    ],
    [
      { kind: 'edit_rows', databaseId: TICKETS_ID, filter: null, values: {} },
      'Choose what to change.',
    ],
    [{ kind: 'open_page', pageId: null, openIn: 'this_tab' }, BUTTON_MESSAGES.noEarlierRow],
    [
      { kind: 'open_page', pageId: 'Tickets', openIn: 'this_tab' },
      'Paste the link to the page to open.',
    ],
    [{ kind: 'open_link', url: 'javascript:alert(1)' }, BUTTON_MESSAGES.badLink],
    [
      { kind: 'send_message', to: nobody, message: 'Intake is open', card: null },
      'Choose who gets the message.',
    ],
    [
      { kind: 'send_message', to: { ...nobody, everyone: true }, message: ' ', card: null },
      'Write the message.',
    ],
    [
      { kind: 'send_message', to: { ...nobody, everyone: true }, message: 'Hi', card: 'new_row' },
      BUTTON_MESSAGES.noEarlierRow,
    ],
    [{ kind: 'confirm', title: ' ', message: '', confirmLabel: 'Go' }, 'Give it a title.'],
  ] as [ButtonAction, string][])('says which step is wrong: %s', (action, message) => {
    const opener: ButtonAction = { kind: 'open_page', pageId: OTHER_PAGE_ID, openIn: 'new_tab' };
    expect(finishSettings(draft([opener, action]), metaOf)).toEqual({
      problem: `Step 2: ${message}`,
    });
  });

  it('gives the shared schema’s message for the rest', () => {
    const result = finishSettings({ ...draft([]), label: 'x'.repeat(101) }, metaOf);
    expect(result).toEqual({ problem: 'A label can be up to 100 characters.' });
  });
});
