import { describe, expect, it } from 'vitest';
import {
  allDayOn,
  dragMove,
  dragResize,
  moveItem,
  nextHalfHour,
  resizeItem,
  slotAt,
  snapMinutes,
  timedAt,
} from './interaction';
import type { GridGeometry } from './interaction';
import { viewRange } from './period';
import type { CalendarItem } from './types';

const timed = (id: string, start: string, end?: string): CalendarItem => ({
  id,
  allDay: false,
  start,
  end,
});
const allDay = (id: string, start: string, end?: string): CalendarItem => ({
  id,
  allDay: true,
  start,
  end,
});
/** A 7-day week, 700 px wide (100 px a day), 48 px an hour (0.8 px a minute). */
const grid: GridGeometry = {
  width: 700,
  hourHeight: 48,
  days: viewRange('week', '2026-10-28', { weekStart: 0, hideWeekends: false }).days,
};
const y = (minutes: number) => (minutes / 60) * 48;
const standup = timed('standup', '2026-10-27T09:00', '2026-10-27T09:30');

describe('snapMinutes', () => {
  it('rounds for drags and floors for clicks, in 15-minute steps', () => {
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(-8)).toBe(-15);
    expect(snapMinutes(-7)).toBe(0);
    expect(Object.is(snapMinutes(-7), -0)).toBe(false);
    expect(snapMinutes(29, 'floor')).toBe(15);
    expect(snapMinutes(50, 'round', 30)).toBe(60);
  });
});

describe('slotAt', () => {
  it('finds the day column and the 15-minute slot under a point', () => {
    expect(slotAt({ x: 250, y: y(10 * 60 + 14) }, grid)).toEqual({
      dayIndex: 2,
      date: '2026-10-27',
      start: '2026-10-27T10:00',
    });
    expect(slotAt({ x: 250, y: y(10 * 60 + 15) }, grid).start).toBe('2026-10-27T10:15');
  });

  it('stays inside the grid', () => {
    expect(slotAt({ x: -40, y: -10 }, grid)).toMatchObject({
      dayIndex: 0,
      start: '2026-10-25T00:00',
    });
    expect(slotAt({ x: 9999, y: y(2000) }, grid)).toMatchObject({
      dayIndex: 6,
      start: '2026-10-31T23:45',
    });
  });

  it('needs at least one day', () => {
    expect(() => slotAt({ x: 0, y: 0 }, { ...grid, days: [] })).toThrow(RangeError);
  });
});

describe('dragMove', () => {
  it('moves in 15-minute steps and keeps the length', () => {
    const from = { x: 250, y: y(9 * 60 + 10) };
    expect(dragMove(standup, from, { x: 250, y: from.y + y(22) }, grid)).toEqual({
      allDay: false,
      start: '2026-10-27T09:15',
      end: '2026-10-27T09:45',
    });
    expect(dragMove(standup, from, { x: 250, y: from.y + y(7) }, grid)).toMatchObject({
      start: '2026-10-27T09:00',
    });
    expect(dragMove(standup, from, { x: 250, y: from.y - y(60) }, grid)).toMatchObject({
      start: '2026-10-27T08:00',
      end: '2026-10-27T08:30',
    });
  });

  it('moves across day columns, and past midnight', () => {
    const from = { x: 250, y: y(9 * 60) };
    expect(dragMove(standup, from, { x: 450, y: from.y + y(60) }, grid)).toMatchObject({
      start: '2026-10-29T10:00',
      end: '2026-10-29T10:30',
    });
    const late = timed('late', '2026-10-27T23:00', '2026-10-28T00:00');
    expect(dragMove(late, { x: 250, y: y(1380) }, { x: 250, y: y(1410) }, grid)).toMatchObject({
      start: '2026-10-27T23:30',
      end: '2026-10-28T00:30',
    });
  });

  it('counts the hidden weekend when moving between day columns', () => {
    const phone: GridGeometry = {
      width: 300,
      hourHeight: 48,
      days: viewRange('week', '2026-10-30', { weekStart: 0, hideWeekends: true, phone: true }).days,
    };
    const friday = timed('friday', '2026-10-30T15:00', '2026-10-30T16:00');
    expect(dragMove(friday, { x: 50, y: 0 }, { x: 150, y: 0 }, phone)).toMatchObject({
      start: '2026-11-02T15:00',
      end: '2026-11-02T16:00',
    });
  });

  it('moves all-day items by whole days only', () => {
    const training = allDay('training', '2026-10-26', '2026-10-27');
    expect(dragMove(training, { x: 150, y: 0 }, { x: 350, y: 200 }, grid)).toEqual({
      allDay: true,
      start: '2026-10-28',
      end: '2026-10-29',
    });
  });

  it('keeps an open end open', () => {
    const due = timed('due', '2026-10-27T17:00');
    expect(dragMove(due, { x: 250, y: 0 }, { x: 250, y: y(30) }, grid)).toEqual({
      allDay: false,
      start: '2026-10-27T17:30',
      end: null,
    });
  });
});

describe('dragResize', () => {
  const from = { x: 250, y: y(9 * 60 + 30) };

  it('changes the end in 15-minute steps', () => {
    expect(dragResize(standup, from, { x: 250, y: from.y + y(38) }, grid)).toEqual({
      allDay: false,
      start: '2026-10-27T09:00',
      end: '2026-10-27T10:15',
    });
  });

  it('never goes below 15 minutes', () => {
    expect(dragResize(standup, from, { x: 250, y: from.y - y(120) }, grid)).toMatchObject({
      end: '2026-10-27T09:15',
    });
  });

  it('can carry the end into the next day column', () => {
    const late = timed('late', '2026-10-27T22:00', '2026-10-27T23:00');
    const start = { x: 250, y: y(23 * 60) };
    expect(dragResize(late, start, { x: 350, y: y(60) }, grid)).toMatchObject({
      end: '2026-10-28T01:00',
    });
  });

  it('does not resize all-day items', () => {
    expect(dragResize(allDay('qa-form', '2026-10-27'), from, from, grid)).toBeNull();
  });
});

describe('moveItem and resizeItem', () => {
  it('keeps the times when moving in Month', () => {
    expect(moveItem(standup, { days: 3 })).toEqual({
      allDay: false,
      start: '2026-10-30T09:00',
      end: '2026-10-30T09:30',
    });
    expect(moveItem(allDay('qa-form', '2026-10-27'), { days: -2 })).toEqual({
      allDay: true,
      start: '2026-10-25',
      end: null,
    });
  });

  it('keeps the wall-clock length across a clock change', () => {
    const night = timed('night', '2026-10-31T23:00', '2026-11-01T03:00');
    expect(moveItem(night, { days: 1 })).toMatchObject({
      start: '2026-11-01T23:00',
      end: '2026-11-02T03:00',
    });
    expect(
      moveItem(timed('dst', '2026-03-08T01:30', '2026-03-08T03:30'), { days: -1 }),
    ).toMatchObject({ start: '2026-03-07T01:30', end: '2026-03-07T03:30' });
  });

  it('lets short items grow but not shrink, and gives open ends a length', () => {
    const ping = timed('ping', '2026-10-27T11:00', '2026-10-27T11:05');
    expect(resizeItem(ping, { minutes: -15 })).toMatchObject({ end: '2026-10-27T11:05' });
    expect(resizeItem(ping, { minutes: 15 })).toMatchObject({ end: '2026-10-27T11:20' });
    const due = timed('due', '2026-10-27T17:00');
    expect(resizeItem(due, { minutes: 0 })).toMatchObject({ end: null });
    expect(resizeItem(due, { minutes: -15 })).toMatchObject({ end: null });
    expect(resizeItem(due, { minutes: 15 })).toMatchObject({ end: '2026-10-27T17:15' });
  });
});

describe('new events', () => {
  it('makes a new event of the default length, or a chosen one', () => {
    expect(timedAt('2026-10-27T10:00')).toEqual({
      allDay: false,
      start: '2026-10-27T10:00',
      end: '2026-10-27T11:00',
    });
    expect(timedAt('2026-10-27T23:45', 30)).toMatchObject({ end: '2026-10-28T00:15' });
    expect(allDayOn('2026-10-27')).toEqual({ allDay: true, start: '2026-10-27', end: null });
  });

  it('switches an item between the all-day row and the hours', () => {
    const training = allDay('training', '2026-10-26', '2026-10-28');
    const slot = slotAt({ x: 250, y: y(14 * 60) }, grid);
    expect({ ...training, ...timedAt(slot.start) }).toMatchObject({
      allDay: false,
      start: '2026-10-27T14:00',
      end: '2026-10-27T15:00',
    });
    expect({ ...standup, ...allDayOn('2026-10-29') }).toMatchObject({
      allDay: true,
      start: '2026-10-29',
      end: null,
    });
  });

  it('starts the C shortcut at the next half hour', () => {
    expect(nextHalfHour('2026-10-26T16:40')).toBe('2026-10-26T17:00');
    expect(nextHalfHour('2026-10-26T16:07')).toBe('2026-10-26T16:30');
    expect(nextHalfHour('2026-10-26T16:30')).toBe('2026-10-26T17:00');
    expect(nextHalfHour('2026-10-26T23:50')).toBe('2026-10-27T00:00');
  });
});
