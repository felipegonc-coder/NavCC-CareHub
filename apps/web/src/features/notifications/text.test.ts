import { describe, expect, it } from 'vitest';
import { formatDay, pausedText, testResultToast } from './text';

describe('testResultToast', () => {
  it('says how many browsers got it', () => {
    expect(testResultToast({ sent: 2, removed: 0, failed: 0 })).toEqual({
      title: 'Test notification sent',
      description: 'Sent to 2 browsers.',
      variant: 'success',
    });
    expect(testResultToast({ sent: 1, removed: 0, failed: 1 }).description).toBe(
      "Sent to 1 browser. 1 browser couldn't be reached this time.",
    );
  });

  it('explains when none got it', () => {
    expect(testResultToast({ sent: 0, removed: 0, failed: 2 })).toMatchObject({
      title: "Couldn't send a test notification",
      description: "2 browsers couldn't be reached. Try again later.",
      variant: 'danger',
    });
    expect(testResultToast({ sent: 0, removed: 1, failed: 0 }).description).toBe(
      '1 browser had stopped getting notifications and was removed. Turn them on again there.',
    );
    expect(testResultToast({ sent: 0, removed: 0, failed: 0 })).toMatchObject({
      title: 'No test notification sent',
      variant: 'default',
    });
  });
});

describe('formatDay', () => {
  it('writes the day as the specs do', () => {
    expect(formatDay('2026-10-27T12:00:00.000Z')).toBe('Oct 27, 2026');
  });
});

describe('pausedText', () => {
  // Made in this computer's time zone, as the screen shows them.
  const now = new Date(2026, 9, 27, 9, 30);
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();

  it('says when the pause ends, with "tomorrow" for the next day', () => {
    expect(pausedText(at(27, 10), now)).toBe('Paused until 10:00 AM.');
    expect(pausedText(at(28, 8), now)).toBe('Paused until tomorrow, 8:00 AM.');
    expect(pausedText(at(29, 20), now)).toBe('Paused until Thu, Oct 29, 8:00 PM.');
  });

  it('says when the pause lasts until notifications are turned back on', () => {
    expect(pausedText(null, now)).toBe('Paused until you turn them back on.');
  });
});
