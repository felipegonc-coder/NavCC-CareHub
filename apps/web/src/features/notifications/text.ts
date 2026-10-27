// Every word of Settings → Notifications, in one place so it can be translated later (Settings
// and members spec, SM-D3). What the browser can't do is PUSH_PROBLEM_TEXT in push-client.ts.
import type { ToastOptions } from '@carehub/ui';
import type { NotifyAbout, TestResult } from './api';

export const NOTIFY_ABOUT_LABEL: Readonly<Record<NotifyAbout, string>> = {
  all: 'All messages',
  mentions: 'Only direct messages, @mentions and notices',
  nothing: 'Nothing',
};

const browsers = (count: number) => (count === 1 ? '1 browser' : `${count} browsers`);

export const TEXT = {
  label: 'Notifications',
  saved: 'Saved',
  retry: 'Retry',

  messages: 'Messages',
  notifyAbout: 'Notify me about',
  showText: 'Show message text in notifications',
  showTextHint:
    'When it\'s off, notifications say only who and what kind, such as "New message" or "Reminder".',
  notSaved: (field: string) => `Couldn't save "${field}". Try again.`,
  settingsFailed: "Couldn't load your notification settings.",

  thisBrowser: 'This browser',
  browserOn: "Notifications are on in this browser, also when Care Hub isn't open.",
  browserOff: "Get notifications in this browser, also when Care Hub isn't open.",
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  turnOffFailed: "Couldn't turn off notifications. Try again.",

  devices: 'Browsers that get notifications',
  devicesHint: 'Remove a browser you no longer use. It stops getting notifications at once.',
  noDevices: 'No browsers get notifications yet.',
  devicesFailed: "Couldn't load your browsers.",
  deviceDates: (added: string, used: string) => `Added ${added} · Last used ${used}`,
  remove: 'Remove',
  removeDevice: (device: string) => `Remove ${device}`,
  removeFailed: (device: string) => `Couldn't remove ${device}. Try again.`,

  sendTest: 'Send a test notification',
  testSent: 'Test notification sent',
  testNone: 'No test notification sent',
  testFailed: "Couldn't send a test notification",
} as const;

/** The toast after "Send a test notification". */
export function testResultToast({ sent, removed, failed }: TestResult): ToastOptions {
  const unreachable = failed > 0 ? ` ${browsers(failed)} couldn't be reached this time.` : '';
  if (sent > 0) {
    return {
      title: TEXT.testSent,
      description: `Sent to ${browsers(sent)}.${unreachable}`,
      variant: 'success',
    };
  }
  if (failed > 0) {
    return {
      title: TEXT.testFailed,
      description: `${browsers(failed)} couldn't be reached. Try again later.`,
      variant: 'danger',
    };
  }
  return {
    title: TEXT.testNone,
    description:
      removed > 0
        ? `${browsers(removed)} had stopped getting notifications and ${removed === 1 ? 'was' : 'were'} removed. Turn them on again there.`
        : 'No browsers get notifications yet. Turn them on in this browser first.',
    variant: 'default',
  };
}

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Oct 27, 2026", in this browser's time zone. */
export function formatDay(iso: string): string {
  return DAY.format(new Date(iso));
}
