import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { slots } from './slots';

describe('notifications slots', () => {
  it('adds Settings → Notifications at /settings/notifications', () => {
    const [section, ...others] = slots.settingsSections ?? [];
    expect(others).toEqual([]);
    expect(section).toMatchObject({
      id: 'notifications',
      label: 'Notifications',
      path: 'notifications',
    });
    expect(section?.permission).toBeUndefined(); // Everyone has it.
    expect(isValidElement(section?.element)).toBe(true);
  });
});
