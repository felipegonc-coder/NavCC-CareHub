import { describe, expect, it } from 'vitest';
import type { NoticeButton } from '../types';
import { getNoticeActionHandler, registerNoticeAction, resolveButtonClick } from './actions';

describe('registerNoticeAction', () => {
  it('runs the handler registered for an action, and the latest one wins', async () => {
    registerNoticeAction('notices-test.done', async () => ({ message: 'Done' }));
    registerNoticeAction('notices-test.done', async () => ({ message: 'Marked as done' }));
    const handler = getNoticeActionHandler('notices-test.done');
    const context = {
      noticeId: '3f1c2d4e-0000-4000-8000-00000000a001',
      workspaceId: '3f1c2d4e-0000-4000-8000-00000000c0de',
      userId: '3f1c2d4e-0000-4000-8000-0000000a7e51',
      action: 'notices-test.done',
      value: null,
    };
    await expect(handler?.(context)).resolves.toEqual({ message: 'Marked as done' });
  });

  it('has no handler for an action nobody registered', () => {
    expect(getNoticeActionHandler('notices-test.unknown')).toBeUndefined();
  });

  it.each(['done', 'Reminders.snooze', 'reminders.', '.snooze', 'reminders snooze', ''])(
    'refuses the name %j',
    (name) => {
      expect(() => registerNoticeAction(name, async () => undefined)).toThrow('<feature>.<name>');
    },
  );
});

describe('resolveButtonClick', () => {
  const buttons: NoticeButton[] = [
    { label: 'Open', href: '/p/3f1c2d4e-0000-4000-8000-0000000c0a01' },
    {
      label: 'Snooze',
      action: 'reminders.snooze',
      choices: [
        { label: '15 min', value: '15m' },
        { label: '1 hour', value: '1h' },
      ],
    },
    { label: 'Done', action: 'reminders.done', value: 'reminder-1' },
  ];

  it('runs a button with its stored action and value', () => {
    expect(resolveButtonClick(buttons, { button: 2 })).toEqual({
      action: 'reminders.done',
      value: 'reminder-1',
    });
    expect(
      resolveButtonClick([{ label: 'Done', action: 'reminders.done' }], { button: 0 }),
    ).toEqual({ action: 'reminders.done', value: null });
  });

  it("runs a menu with the picked choice's value", () => {
    expect(resolveButtonClick(buttons, { button: 1, choice: 1 })).toEqual({
      action: 'reminders.snooze',
      value: '1h',
    });
  });

  it.each([
    { button: 0 },
    { button: 3 },
    { button: -1 },
    { button: 1 },
    { button: 1, choice: 2 },
    { button: 2, choice: 0 },
  ])('ignores the click %j', (click) => {
    expect(resolveButtonClick(buttons, click)).toBeNull();
  });
});
