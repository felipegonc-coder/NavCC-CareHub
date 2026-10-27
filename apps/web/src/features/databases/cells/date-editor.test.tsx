import type { Property } from '@carehub/databases';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { jobsProperties, PROPS } from '../fixtures';
import { CELL_TEXT, DAY_REMINDER_LABELS, TIME_REMINDER_LABELS } from './messages';
import { openEditor, pressOutside } from './test-helpers';

const due: Property = (() => {
  const found = jobsProperties().find((p) => p.id === PROPS.due);
  if (!found) throw new Error('No Due date property');
  return found;
})();
const day = (start: string, end: string | null = null) => ({ start, end, hasTime: false });
const field = (label: string) => screen.getByLabelText(label);
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const key = (el: HTMLElement, k: string, init: Record<string, unknown> = {}) =>
  fireEvent.keyDown(el, { key: k, ...init });
const choices = (label: string) =>
  within(field(label))
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('DateEditor', () => {
  it('picks a day and saves it with Enter', async () => {
    const { onCommit } = await openEditor({ property: due, value: null });
    expect(field(CELL_TEXT.date)).toHaveFocus();
    type(field(CELL_TEXT.date), '2026-10-26');
    key(field(CELL_TEXT.date), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(day('2026-10-26'), { changed: true });
  });

  it('adds an end date and refuses one before the start', async () => {
    const { onCommit } = await openEditor({ property: due, value: day('2026-10-26') });
    fireEvent.click(screen.getByRole('switch', { name: CELL_TEXT.endDate }));
    expect(field(CELL_TEXT.start)).toHaveValue('2026-10-26');
    expect(field(CELL_TEXT.end)).toHaveValue('2026-10-26');
    type(field(CELL_TEXT.end), '2026-10-25');
    key(field(CELL_TEXT.end), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent(
      "The end date can't be before the start date.",
    );
    expect(onCommit).not.toHaveBeenCalled();
    type(field(CELL_TEXT.end), '2026-10-28');
    key(field(CELL_TEXT.end), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(day('2026-10-26', '2026-10-28'), { changed: true });
  });

  it('adds a time in the viewer’s time zone', async () => {
    const { onCommit } = await openEditor({ property: due, value: day('2026-10-26') });
    fireEvent.click(screen.getByRole('switch', { name: CELL_TEXT.includeTime }));
    expect(field(CELL_TEXT.startTime)).toHaveValue('09:00');
    expect(field(CELL_TEXT.timeZone)).toHaveDisplayValue(CELL_TEXT.viewerTimeZone);
    key(field(CELL_TEXT.startTime), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(
      { start: '2026-10-26T15:00:00.000Z', end: null, hasTime: true },
      { changed: true },
    );
  });

  it('can keep a date and time in a fixed time zone', async () => {
    const { onCommit } = await openEditor({ property: due, value: day('2026-10-26') });
    fireEvent.click(screen.getByRole('switch', { name: CELL_TEXT.includeTime }));
    expect(
      within(field(CELL_TEXT.timeZone)).getByRole('option', { name: 'America/New York' }),
    ).toBeInTheDocument();
    type(field(CELL_TEXT.timeZone), 'Asia/Tokyo');
    type(field(CELL_TEXT.startTime), '09:30');
    key(field(CELL_TEXT.timeZone), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(
      { start: '2026-10-26T00:30:00.000Z', end: null, hasTime: true, timeZone: 'Asia/Tokyo' },
      { changed: true },
    );
  });

  it('opens a time range in its own time zone', async () => {
    await openEditor({
      property: due,
      value: {
        start: '2026-10-26T00:30:00.000Z',
        end: '2026-10-26T02:00:00.000Z',
        hasTime: true,
        timeZone: 'Asia/Tokyo',
      },
    });
    expect(field(CELL_TEXT.start)).toHaveValue('2026-10-26');
    expect(field(CELL_TEXT.startTime)).toHaveValue('09:30');
    expect(field(CELL_TEXT.end)).toHaveValue('2026-10-26');
    expect(field(CELL_TEXT.endTime)).toHaveValue('11:00');
    expect(field(CELL_TEXT.timeZone)).toHaveValue('Asia/Tokyo');
  });

  it('offers reminders on the day or days before, at 9:00 AM', async () => {
    const { onCommit } = await openEditor({ property: due, value: day('2026-10-26') });
    expect(choices(CELL_TEXT.remind)).toEqual([
      CELL_TEXT.none,
      ...Object.values(DAY_REMINDER_LABELS),
    ]);
    type(field(CELL_TEXT.remind), 'd:1');
    key(field(CELL_TEXT.remind), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(
      { ...day('2026-10-26'), reminder: { daysBefore: 1 } },
      { changed: true },
    );
  });

  it('offers reminders before a time, with ones already set kept in order', async () => {
    const at = (minutesBefore: 15 | 30 | 120) => ({
      start: '2026-10-26T15:00:00.000Z',
      end: null,
      hasTime: true,
      reminder: { minutesBefore },
    });
    const shown = [0, 5, 10, 60, 1440, 2880].map((m) => TIME_REMINDER_LABELS[m]);
    const first = await openEditor({ property: due, value: day('2026-10-26') });
    fireEvent.click(screen.getByRole('switch', { name: CELL_TEXT.includeTime }));
    expect(choices(CELL_TEXT.remind)).toEqual([CELL_TEXT.none, ...shown]);
    first.unmount();
    for (const minutes of [15, 30, 120] as const) {
      const view = await openEditor({ property: due, value: at(minutes) });
      const list = choices(CELL_TEXT.remind);
      expect(list).toContain(TIME_REMINDER_LABELS[minutes]);
      expect(list).toHaveLength(shown.length + 2);
      expect(field(CELL_TEXT.remind)).toHaveDisplayValue(TIME_REMINDER_LABELS[minutes] ?? '');
      view.unmount();
    }
  });

  it('clears the date', async () => {
    const { onCommit } = await openEditor({ property: due, value: day('2026-10-26') });
    fireEvent.click(screen.getByRole('button', { name: CELL_TEXT.clear }));
    expect(onCommit).toHaveBeenCalledWith(null, { changed: true });
  });

  it('saves and moves on with Tab from the last control and Shift+Tab from the first', async () => {
    const next = await openEditor({ property: due, value: day('2026-10-26') });
    key(field(CELL_TEXT.date), 'Tab');
    expect(next.onCommit).not.toHaveBeenCalled();
    key(screen.getByRole('button', { name: CELL_TEXT.clear }), 'Tab');
    expect(next.onCommit).toHaveBeenCalledWith(day('2026-10-26'), {
      changed: false,
      move: 'next',
    });
    next.unmount();
    const back = await openEditor({ property: due, value: day('2026-10-26') });
    key(field(CELL_TEXT.date), 'Tab', { shiftKey: true });
    expect(back.onCommit).toHaveBeenCalledWith(day('2026-10-26'), {
      changed: false,
      move: 'previous',
    });
  });

  it('leaves on Escape, and on a press outside saves unless the dates are wrong', async () => {
    const escaped = await openEditor({ property: due, value: day('2026-10-26') });
    key(field(CELL_TEXT.date), 'Escape');
    expect(escaped.onCancel).toHaveBeenCalledTimes(1);
    escaped.unmount();
    const saved = await openEditor({ property: due, value: day('2026-10-26') });
    type(field(CELL_TEXT.date), '2026-10-27');
    pressOutside();
    expect(saved.onCommit).toHaveBeenCalledWith(day('2026-10-27'), { changed: true });
    saved.unmount();
    const wrong = await openEditor({ property: due, value: day('2026-10-26', '2026-10-28') });
    type(field(CELL_TEXT.end), '2026-10-01');
    pressOutside();
    expect(wrong.onCommit).not.toHaveBeenCalled();
    expect(wrong.onCancel).toHaveBeenCalledTimes(1);
  });
});
