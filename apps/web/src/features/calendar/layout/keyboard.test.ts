import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  gridKeyAction,
  monthFocusOrder,
  moreKey,
  moveFocus,
  weekFocusOrder,
} from './keyboard';
import { layoutAllDayRow, layoutMonth } from './lanes';
import { monthMatrix } from './period';
import { layoutTimeGrid } from './timeGrid';
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

describe('gridKeyAction', () => {
  it('maps arrows to focus moves', () => {
    expect(gridKeyAction({ key: 'ArrowDown' })).toEqual({ kind: 'focus', move: 'down' });
    expect(gridKeyAction({ key: 'ArrowLeft' })).toEqual({ kind: 'focus', move: 'left' });
  });

  it('maps Alt and Alt+Shift arrows to edits', () => {
    expect(gridKeyAction({ key: 'ArrowUp', altKey: true })).toEqual({
      kind: 'edit',
      step: 'earlier',
    });
    expect(gridKeyAction({ key: 'ArrowDown', altKey: true })).toEqual({
      kind: 'edit',
      step: 'later',
    });
    expect(gridKeyAction({ key: 'ArrowLeft', altKey: true })).toEqual({
      kind: 'edit',
      step: 'day-before',
    });
    expect(gridKeyAction({ key: 'ArrowRight', altKey: true })).toEqual({
      kind: 'edit',
      step: 'day-after',
    });
    expect(gridKeyAction({ key: 'ArrowUp', altKey: true, shiftKey: true })).toEqual({
      kind: 'edit',
      step: 'end-earlier',
    });
    expect(gridKeyAction({ key: 'ArrowDown', altKey: true, shiftKey: true })).toEqual({
      kind: 'edit',
      step: 'end-later',
    });
  });

  it('maps Ctrl+D to duplicate, with real KeyboardEvent flags and Caps Lock', () => {
    const flags = { altKey: false, shiftKey: false, metaKey: false };
    expect(gridKeyAction({ key: 'd', ctrlKey: true, ...flags })).toEqual({ kind: 'duplicate' });
    expect(gridKeyAction({ key: 'D', ctrlKey: true })).toEqual({ kind: 'duplicate' });
    expect(gridKeyAction({ key: 'd' })).toBeNull();
    expect(gridKeyAction({ key: 'd', metaKey: true })).toBeNull();
    expect(gridKeyAction({ key: 'D', ctrlKey: true, shiftKey: true })).toBeNull();
    expect(gridKeyAction({ key: 'd', ctrlKey: true, altKey: true })).toBeNull();
  });

  it('leaves other keys and combinations alone', () => {
    expect(gridKeyAction({ key: 'ArrowRight', altKey: true, shiftKey: true })).toBeNull();
    expect(gridKeyAction({ key: 'ArrowUp', shiftKey: true })).toBeNull();
    expect(gridKeyAction({ key: 'ArrowUp', ctrlKey: true })).toBeNull();
    expect(gridKeyAction({ key: 'ArrowUp', altKey: true, metaKey: true })).toBeNull();
    expect(gridKeyAction({ key: 'Enter' })).toBeNull();
    expect(gridKeyAction({ key: 't' })).toBeNull();
  });
});

describe('applyEdit', () => {
  const standup = timed('standup', '2026-10-30T09:00', '2026-10-30T09:15');

  it('moves 15 minutes or a day, and changes the end by 15 minutes', () => {
    expect(applyEdit(standup, 'earlier')).toMatchObject({ start: '2026-10-30T08:45' });
    expect(applyEdit(standup, 'later')).toMatchObject({
      start: '2026-10-30T09:15',
      end: '2026-10-30T09:30',
    });
    expect(applyEdit(standup, 'day-after')).toMatchObject({ start: '2026-10-31T09:00' });
    expect(applyEdit(standup, 'day-before')).toMatchObject({ start: '2026-10-29T09:00' });
    expect(applyEdit(standup, 'end-later')).toMatchObject({ end: '2026-10-30T09:30' });
    expect(applyEdit(standup, 'end-earlier')).toMatchObject({ end: '2026-10-30T09:15' });
  });

  it('skips hidden weekends when moving a day', () => {
    expect(applyEdit(standup, 'day-after', { skipWeekends: true })).toMatchObject({
      start: '2026-11-02T09:00',
      end: '2026-11-02T09:15',
    });
    const monday = timed('monday', '2026-11-02T09:00', '2026-11-02T10:00');
    expect(applyEdit(monday, 'day-before', { skipWeekends: true })).toMatchObject({
      start: '2026-10-30T09:00',
    });
  });

  it('moves all-day items by days only', () => {
    const training = allDay('training', '2026-10-29', '2026-10-30');
    expect(applyEdit(training, 'day-after')).toEqual({
      allDay: true,
      start: '2026-10-30',
      end: '2026-10-31',
    });
    expect(applyEdit(training, 'earlier')).toBeNull();
    expect(applyEdit(training, 'end-later')).toBeNull();
  });
});

describe('week reading order', () => {
  const days = ['2026-10-26', '2026-10-27', '2026-10-28'];
  const items = [
    allDay('training', '2026-10-26', '2026-10-27'),
    allDay('qa-form', '2026-10-27'),
    timed('standup-mon', '2026-10-26T09:00', '2026-10-26T09:15'),
    timed('review', '2026-10-26T14:00', '2026-10-26T15:00'),
    timed('call-a', '2026-10-27T10:00', '2026-10-27T11:00'),
    timed('call-b', '2026-10-27T10:00', '2026-10-27T10:30'),
    timed('late', '2026-10-28T16:00', '2026-10-28T17:00'),
  ];
  const order = weekFocusOrder(layoutAllDayRow(items, days), layoutTimeGrid(items, days));
  const keys = order.map((entry) => entry.key);

  it('reads day by day: the all-day row, then the hours in time order, left to right', () => {
    expect(keys).toEqual([
      'training@2026-10-26',
      'standup-mon@2026-10-26',
      'review@2026-10-26',
      'qa-form@2026-10-27',
      'call-a@2026-10-27',
      'call-b@2026-10-27',
      'late@2026-10-28',
    ]);
  });

  it('starts at the first item when Tab reaches the grid', () => {
    expect(moveFocus(order, null, 'down')).toBe('training@2026-10-26');
    expect(moveFocus(order, 'gone@2026-10-26', 'right')).toBe('training@2026-10-26');
    expect(moveFocus([], null, 'down')).toBeNull();
  });

  it('moves up and down within a day only', () => {
    expect(moveFocus(order, 'training@2026-10-26', 'down')).toBe('standup-mon@2026-10-26');
    expect(moveFocus(order, 'review@2026-10-26', 'down')).toBeNull();
    expect(moveFocus(order, 'qa-form@2026-10-27', 'up')).toBeNull();
  });

  it('moves left and right to the closest item on the nearest day with items', () => {
    expect(moveFocus(order, 'review@2026-10-26', 'right')).toBe('call-a@2026-10-27');
    expect(moveFocus(order, 'training@2026-10-26', 'right')).toBe('qa-form@2026-10-27');
    expect(moveFocus(order, 'late@2026-10-28', 'left')).toBe('call-a@2026-10-27');
    expect(moveFocus(order, 'standup-mon@2026-10-26', 'left')).toBeNull();
    const gap = weekFocusOrder(
      null,
      layoutTimeGrid(
        items.filter((i) => i.id !== 'call-a' && i.id !== 'call-b'),
        days,
      ),
    );
    expect(moveFocus(gap, 'review@2026-10-26', 'right')).toBe('late@2026-10-28');
  });
});

describe('month reading order', () => {
  it('reads day by day across weeks, with "+N more" after the drawn items', () => {
    const busy = ['a', 'b', 'c', 'd'].map((id) => allDay(id, '2026-10-17'));
    const month = layoutMonth(
      [
        ...busy,
        allDay('qa-form', '2026-10-18'),
        timed('standup', '2026-10-16T09:00', '2026-10-16T09:15'),
      ],
      monthMatrix('2026-10-01', { weekStart: 0, hideWeekends: false }),
    );
    const order = monthFocusOrder(month);
    expect(order.map((entry) => entry.key)).toEqual([
      'standup@2026-10-16',
      'a@2026-10-17',
      'b@2026-10-17',
      'c@2026-10-17',
      moreKey('2026-10-17'),
      'qa-form@2026-10-18',
    ]);
    expect(moveFocus(order, moreKey('2026-10-17'), 'right')).toBe('qa-form@2026-10-18');
    expect(moveFocus(order, 'qa-form@2026-10-18', 'left')).toBe('a@2026-10-17');
    expect(moveFocus(order, 'c@2026-10-17', 'down')).toBe(moreKey('2026-10-17'));
  });
});
