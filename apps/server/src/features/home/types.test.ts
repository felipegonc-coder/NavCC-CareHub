import { describe, expect, it } from 'vitest';
import { HOME_SECTION_IDS, homeSettingsChangeSchema, inHomeOrder } from './types';

const messageOf = (body: unknown) =>
  homeSettingsChangeSchema.safeParse(body).error?.issues[0]?.message;

describe('Home settings changes', () => {
  it('takes either setting, or both', () => {
    expect(homeSettingsChangeSchema.parse({ upcomingFolded: true })).toEqual({
      upcomingFolded: true,
    });
    expect(homeSettingsChangeSchema.parse({ hiddenSections: [] })).toEqual({ hiddenSections: [] });
    expect(
      homeSettingsChangeSchema.parse({ hiddenSections: ['recent'], upcomingFolded: false }),
    ).toEqual({ hiddenSections: ['recent'], upcomingFolded: false });
  });

  it('says what is wrong', () => {
    expect(messageOf({})).toBe('Nothing to change.');
    expect(messageOf({ hiddenSections: ['weather'] })).toBe("That isn't a section of Home.");
    expect(messageOf({ hiddenSections: [...HOME_SECTION_IDS, 'recent'] })).toBe(
      'Each section can be hidden once.',
    );
    expect(messageOf({ upcomingFolded: 'yes' })).toBe('Folded is true or false.');
    // Settings are only ever the signed-in person's own.
    expect(homeSettingsChangeSchema.safeParse({ userId: 'someone-else' }).success).toBe(false);
    expect(homeSettingsChangeSchema.safeParse(null).success).toBe(false);
  });

  it('keeps sections once each, in Home’s order', () => {
    expect(inHomeOrder(['recent', 'upcoming', 'recent', 'weather'])).toEqual([
      'upcoming',
      'recent',
    ]);
    expect(inHomeOrder([])).toEqual([]);
  });
});
