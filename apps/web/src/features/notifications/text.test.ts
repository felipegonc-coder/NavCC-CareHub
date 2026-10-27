import { describe, expect, it } from 'vitest';
import { formatDay, testResultToast } from './text';

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
