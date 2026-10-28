import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CalendarShortcuts, type CalendarShortcutsProps } from './CalendarShortcuts';

// Tuesday, October 27, 2026 at 10:10 AM, in the person's time zone.
const NOW = '2026-10-27T10:10';

function renderShortcuts(props: Partial<CalendarShortcutsProps> = {}) {
  const onView = vi.fn();
  const onStep = vi.fn();
  const view = render(
    <CalendarShortcuts on now={NOW} onView={onView} onStep={onStep} {...props} />,
  );
  return { onView, onStep, ...view };
}

/** A key pressed with nothing focused. False when the shortcut stopped the browser's own action. */
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.body, { key, ...init });

describe('CalendarShortcuts', () => {
  it('switches views with D, W and M, and steps with T, J, K and the arrows', () => {
    const { onView, onStep } = renderShortcuts();
    for (const key of ['d', 'w', 'M']) expect(press(key)).toBe(false);
    expect(onView.mock.calls).toEqual([['day'], ['week'], ['month']]);
    for (const key of ['t', 'j', 'ArrowRight', 'k', 'ArrowLeft']) press(key);
    expect(onStep.mock.calls).toEqual([['today'], ['next'], ['next'], ['previous'], ['previous']]);
  });

  it('makes a new event at the next half hour with C, of the default length', () => {
    const onNewEvent = vi.fn();
    const { rerender } = renderShortcuts({ onNewEvent });
    expect(press('c')).toBe(false);
    expect(onNewEvent).toHaveBeenLastCalledWith({
      allDay: false,
      start: '2026-10-27T10:30',
      end: '2026-10-27T11:30',
    });
    rerender(
      <CalendarShortcuts
        on
        now="2026-10-27T10:30"
        defaultLength={30}
        onView={vi.fn()}
        onStep={vi.fn()}
        onNewEvent={onNewEvent}
      />,
    );
    press('C');
    expect(onNewEvent).toHaveBeenLastCalledWith({
      allDay: false,
      start: '2026-10-27T11:00',
      end: '2026-10-27T11:30',
    });
  });

  it('deletes with Delete or Backspace and closes with Esc, only when the screen can', () => {
    renderShortcuts();
    // Nothing to make, delete or close: the browser keeps these keys.
    for (const key of ['c', 'Delete', 'Backspace', 'Escape']) expect(press(key)).toBe(true);
  });

  it('asks the screen to delete the selected event, and to close its panel', () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    renderShortcuts({ onDelete, onClose });
    expect(press('Delete')).toBe(false);
    press('Backspace');
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(press('Escape')).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('lists every shortcut with ?, and keeps single keys out of that list', () => {
    const { onView } = renderShortcuts({ onClose: vi.fn() });
    expect(screen.queryByRole('dialog')).toBeNull();
    press('?', { shiftKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog).toHaveAccessibleDescription(
      'Single keys work anywhere in Calendar, except while you type in a field.',
    );
    for (const text of ['New event at the next half hour', 'Open the event', 'Duplicate it']) {
      expect(within(dialog).getByText(text)).toBeInTheDocument();
    }
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Close' }), { key: 'w' });
    expect(onView).not.toHaveBeenCalled();
  });

  it('does nothing while typing in a field', () => {
    const { onView, onStep } = renderShortcuts();
    render(<input aria-label="Title" />);
    const title = screen.getByRole('textbox', { name: 'Title' });
    for (const key of ['w', 'd', 't', 'j', 'ArrowLeft']) {
      expect(fireEvent.keyDown(title, { key })).toBe(true);
    }
    expect(onView).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
  });

  it('does nothing with the switch off, until it is on again', () => {
    const onView = vi.fn();
    const onNewEvent = vi.fn();
    const props = { now: NOW, onView, onStep: vi.fn(), onNewEvent };
    const { rerender } = render(<CalendarShortcuts on={false} {...props} />);
    for (const key of ['d', 'c']) expect(press(key)).toBe(true);
    press('?', { shiftKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onView).not.toHaveBeenCalled();
    expect(onNewEvent).not.toHaveBeenCalled();
    rerender(<CalendarShortcuts on {...props} />);
    press('d');
    expect(onView).toHaveBeenCalledWith('day');
  });
});
