import { describe, expect, it } from 'vitest';
import { fillVariables } from './content';
import { formatDay, formatMoment, variableValues } from './variables';

const chip = (kind: string, offsetDays = 0) =>
  `<!-- carehub:inline {"type":"templateVariable","attrs":{"kind":"${kind}","offsetDays":${offsetDays}}} -->`;

describe('variable values', () => {
  const values = variableValues({
    person: { name: 'Avery Lin', timeZone: 'America/Denver', use24h: false },
    page: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', title: 'Q4 *launch*' },
    // 2026-10-27 02:30 in Denver: still Oct 27 there, Oct 27 in UTC too.
    now: new Date('2026-10-27T08:30:00Z'),
  });

  it('fills Today with an offset in the person’s time zone', () => {
    expect(fillVariables(`Due ${chip('today', 3)}`, values)).toBe('Due Oct 30, 2026');
    expect(formatDay('2026-01-05')).toBe('Jan 5, 2026');
  });

  it('fills Now with the time, and Me and This page', () => {
    expect(fillVariables(chip('now'), values)).toBe('Oct 27, 2026, 2:30 AM');
    expect(formatMoment('2026-10-27T20:05:00Z', 'America/Denver', true)).toBe(
      'Oct 27, 2026, 14:05',
    );
    expect(fillVariables(`By ${chip('me')}`, values)).toBe('By Avery Lin');
    expect(fillVariables(chip('this_page'), values)).toBe(
      '[Q4 \\*launch\\*](</p/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee>)',
    );
  });

  it('uses the day in the person’s time zone, not the server’s', () => {
    const late = variableValues({
      person: { name: 'Sam Ortiz', timeZone: 'America/Denver', use24h: false },
      page: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', title: '' },
      // 11:30 PM on Oct 26 in Denver is already Oct 27 in UTC.
      now: new Date('2026-10-27T05:30:00Z'),
    });
    expect(fillVariables(chip('today'), late)).toBe('Oct 26, 2026');
  });
});
