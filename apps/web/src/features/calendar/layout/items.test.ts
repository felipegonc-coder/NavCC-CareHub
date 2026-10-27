import { describe, expect, it } from 'vitest';
import { visibleItems } from './items';
import type { CalendarItem } from './types';

const items: CalendarItem[] = [
  { id: 'standup', allDay: false, start: '2026-10-27T09:00', end: '2026-10-27T09:15' },
  { id: 'offsite', allDay: true, start: '2026-10-27', declined: true },
  { id: 'qa-review', allDay: false, start: '2026-10-27T10:00', declined: false },
];

describe('visibleItems', () => {
  it('leaves out declined items only with Hide declined events on', () => {
    expect(visibleItems(items, { hideDeclined: true }).map((item) => item.id)).toEqual([
      'standup',
      'qa-review',
    ]);
    expect(visibleItems(items, { hideDeclined: false })).toEqual(items);
    expect(visibleItems(items, {})).toEqual(items);
  });

  it('takes the grid options as they are', () => {
    const options = { weekStart: 1, hideWeekends: false, hideDeclined: true } as const;
    expect(visibleItems(items, options)).toHaveLength(2);
  });
});
