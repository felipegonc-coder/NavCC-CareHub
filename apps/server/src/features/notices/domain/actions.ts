import type { NoticeActionHandler, NoticeButton } from '../types';

const ACTION_NAME = /^[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9.-]*$/;
const handlers = new Map<string, NoticeActionHandler>();

/**
 * Runs `handler` when a notice's owner clicks an action button with this `action`, such as
 * `reminders.snooze`. Register at start-up. Handlers must be idempotent (people double-click);
 * registering the same name again replaces the handler (tests start several apps).
 */
export function registerNoticeAction(action: string, handler: NoticeActionHandler): void {
  if (action.length > 100 || !ACTION_NAME.test(action)) {
    throw new Error(
      `Notice actions are named <feature>.<name>, such as reminders.snooze: ${action}`,
    );
  }
  handlers.set(action, handler);
}

export function getNoticeActionHandler(action: string): NoticeActionHandler | undefined {
  return handlers.get(action);
}

/** Which button the browser says was clicked: its index, and the index of the picked choice. */
export interface ButtonClick {
  button: number;
  choice?: number | undefined;
}

/**
 * The action and value a click runs, taken from the stored buttons (never from the browser), or
 * null when the click doesn't match an action button: a link, an index out of range, or a
 * missing or extra choice.
 */
export function resolveButtonClick(
  buttons: readonly NoticeButton[],
  click: ButtonClick,
): { action: string; value: string | null } | null {
  const button = buttons[click.button];
  if (!button || 'href' in button) return null;
  if (!button.choices) {
    return click.choice === undefined
      ? { action: button.action, value: button.value ?? null }
      : null;
  }
  if (click.choice === undefined) return null;
  const choice = button.choices[click.choice];
  return choice ? { action: button.action, value: choice.value } : null;
}
