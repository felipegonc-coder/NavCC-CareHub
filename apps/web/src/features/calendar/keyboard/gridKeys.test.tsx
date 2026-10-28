import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarItem, FocusEntry } from '../layout';
import { CalendarShortcuts } from './CalendarShortcuts';
import { useGridKeys, type GridKeysOptions } from './gridKeys';

// Fictional items in the week of Sunday, October 25, 2026: Tuesday has an all-day item and two
// timed ones; Wednesday has one at 10:45.
const items: CalendarItem[] = [
  { id: 'offsite', allDay: true, start: '2026-10-27' },
  { id: 'huddle', allDay: false, start: '2026-10-27T09:00', end: '2026-10-27T10:00' },
  { id: 'review', allDay: false, start: '2026-10-27T11:00', end: '2026-10-27T12:00' },
  { id: 'training', allDay: false, start: '2026-10-28T10:45', end: '2026-10-28T11:15' },
];
const order: FocusEntry[] = [
  { key: 'offsite@2026-10-27', dayIndex: 0, position: -10_000 },
  { key: 'huddle@2026-10-27', dayIndex: 0, position: 540 },
  { key: 'review@2026-10-27', dayIndex: 0, position: 660 },
  { key: 'training@2026-10-28', dayIndex: 1, position: 645 },
];

/** A grid of plain buttons, named by their keys. */
function Grid(props: Omit<GridKeysOptions<CalendarItem>, 'items'> & { items?: CalendarItem[] }) {
  const keys = useGridKeys({ items, ...props });
  return (
    <div {...keys.gridProps}>
      {props.order.map((entry) => (
        <button key={entry.key} type="button" {...keys.itemProps(entry.key)}>
          {entry.key}
        </button>
      ))}
    </div>
  );
}

const block = (key: string) => screen.getByRole('button', { name: key });
const focus = (key: string) => act(() => block(key).focus());
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });

describe('useGridKeys', () => {
  it('makes the grid one tab stop, on the item focused last', () => {
    render(<Grid order={order} />);
    expect(block('offsite@2026-10-27')).toHaveAttribute('tabindex', '0');
    expect(block('review@2026-10-27')).toHaveAttribute('tabindex', '-1');
    focus('review@2026-10-27');
    expect(block('review@2026-10-27')).toHaveAttribute('tabindex', '0');
    expect(block('offsite@2026-10-27')).toHaveAttribute('tabindex', '-1');
  });

  it('moves between items with the arrows: ↑ ↓ within a day, ← → across days', () => {
    render(<Grid order={order} />);
    focus('huddle@2026-10-27');
    expect(press('ArrowDown')).toBe(false);
    expect(block('review@2026-10-27')).toHaveFocus();
    press('ArrowDown');
    expect(block('review@2026-10-27')).toHaveFocus();
    press('ArrowRight');
    expect(block('training@2026-10-28')).toHaveFocus();
    // Back to the closest one in time.
    press('ArrowLeft');
    expect(block('review@2026-10-27')).toHaveFocus();
    press('ArrowUp');
    press('ArrowUp');
    expect(block('offsite@2026-10-27')).toHaveFocus();
  });

  it('keeps ← and → for the grid while an item has focus, and for the period otherwise', () => {
    const onStep = vi.fn();
    render(
      <>
        <CalendarShortcuts on now="2026-10-27T08:00" onView={vi.fn()} onStep={onStep} />
        <Grid order={order} />
      </>,
    );
    focus('huddle@2026-10-27');
    press('ArrowRight');
    expect(block('training@2026-10-28')).toHaveFocus();
    expect(onStep).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(onStep).toHaveBeenCalledWith('next');
  });

  it('moves the item with Alt+arrows and changes its end with Alt+Shift+↑ and ↓', () => {
    const onEdit = vi.fn();
    render(<Grid order={order} onEdit={onEdit} />);
    focus('huddle@2026-10-27');
    const huddle = items[1];
    expect(press('ArrowDown', { altKey: true })).toBe(false);
    expect(onEdit).toHaveBeenLastCalledWith(huddle, {
      allDay: false,
      start: '2026-10-27T09:15',
      end: '2026-10-27T10:15',
    });
    press('ArrowUp', { altKey: true });
    expect(onEdit).toHaveBeenLastCalledWith(huddle, {
      allDay: false,
      start: '2026-10-27T08:45',
      end: '2026-10-27T09:45',
    });
    press('ArrowRight', { altKey: true });
    expect(onEdit).toHaveBeenLastCalledWith(huddle, {
      allDay: false,
      start: '2026-10-28T09:00',
      end: '2026-10-28T10:00',
    });
    press('ArrowDown', { altKey: true, shiftKey: true });
    expect(onEdit).toHaveBeenLastCalledWith(huddle, {
      allDay: false,
      start: '2026-10-27T09:00',
      end: '2026-10-27T10:15',
    });
    // An all-day item moves by days only.
    focus('offsite@2026-10-27');
    onEdit.mockClear();
    expect(press('ArrowDown', { altKey: true })).toBe(false);
    expect(onEdit).not.toHaveBeenCalled();
    press('ArrowLeft', { altKey: true });
    expect(onEdit).toHaveBeenCalledWith(items[0], { allDay: true, start: '2026-10-26', end: null });
  });

  it('skips the weekend on Alt+→ when weekends are hidden', () => {
    const onEdit = vi.fn();
    const audit: CalendarItem = { id: 'audit', allDay: true, start: '2026-10-30' };
    render(
      <Grid
        items={[audit]}
        order={[{ key: 'audit@2026-10-30', dayIndex: 0, position: -10_000 }]}
        onEdit={onEdit}
        skipWeekends
      />,
    );
    focus('audit@2026-10-30');
    press('ArrowRight', { altKey: true });
    expect(onEdit).toHaveBeenCalledWith(audit, { allDay: true, start: '2026-11-02', end: null });
  });

  it('duplicates the item with Ctrl+D', () => {
    const onDuplicate = vi.fn();
    render(<Grid order={order} onDuplicate={onDuplicate} />);
    focus('review@2026-10-27');
    expect(press('d', { ctrlKey: true })).toBe(false);
    expect(onDuplicate).toHaveBeenCalledWith(items[2]);
  });

  it('follows a moved item to its new day', () => {
    const { rerender } = render(<Grid order={order} onEdit={vi.fn()} />);
    focus('huddle@2026-10-27');
    press('ArrowRight', { altKey: true });
    const moved = order
      .map((entry) =>
        entry.key === 'huddle@2026-10-27'
          ? { ...entry, key: 'huddle@2026-10-28', dayIndex: 1 }
          : entry,
      )
      .sort((a, b) => a.dayIndex - b.dayIndex || a.position - b.position);
    rerender(<Grid order={moved} onEdit={vi.fn()} />);
    expect(block('huddle@2026-10-28')).toHaveFocus();
    expect(block('huddle@2026-10-28')).toHaveAttribute('tabindex', '0');
  });

  it('leaves other keys and other elements alone', () => {
    const onEdit = vi.fn();
    render(
      <>
        <Grid order={order} onEdit={onEdit} />
        <button type="button">Outside</button>
      </>,
    );
    focus('huddle@2026-10-27');
    expect(press('Enter')).toBe(true);
    expect(press('ArrowDown', { shiftKey: true })).toBe(true);
    expect(press('d', { ctrlKey: true })).toBe(true);
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    expect(press('ArrowDown', { altKey: true })).toBe(true);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
