import type { ButtonAction } from '@carehub/extras/templates/buttons';
import { describe, expect, it } from 'vitest';
import { newAction, rowStepBefore } from './action-fields';

describe('new steps', () => {
  it('starts Open a page on the row an earlier step adds, if there is one', () => {
    expect(newAction('open_page', true)).toEqual({
      kind: 'open_page',
      pageId: null,
      openIn: 'this_tab',
    });
    expect(newAction('open_page', false)).toMatchObject({ pageId: '' });
  });

  it('starts a message with this page as its card, to no one yet', () => {
    expect(newAction('send_message', false)).toMatchObject({
      to: { userIds: [], groupIds: [], roleIds: [], everyone: false },
      card: 'this_page',
    });
  });

  it('finds the step number of the last Add a row before a step', () => {
    const actions: ButtonAction[] = [
      newAction('add_row', false),
      newAction('open_link', false),
      newAction('add_row', false),
      newAction('open_page', true),
    ];
    expect(rowStepBefore(actions, 0)).toBeNull();
    expect(rowStepBefore(actions, 2)).toBe(1);
    expect(rowStepBefore(actions, 3)).toBe(3);
  });
});
