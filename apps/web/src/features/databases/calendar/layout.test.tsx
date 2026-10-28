import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  defaultView,
  type CalendarOptions,
  type DateValue,
  type Property,
  type Row,
  type View,
} from '@carehub/databases';
import {
  fixtureRow,
  jobsDatabase,
  jobsProperties,
  jobsRows,
  layoutProps,
  PROPS,
  queryData,
  testViewer,
  viewData,
} from '../test-utils';
import CalendarLayout from './layout';

const day = (start: string, end: string | null = null): DateValue => ({
  start,
  end,
  hasTime: false,
});
const timed = (start: string, end: string | null = null): DateValue => ({
  start,
  end,
  hasTime: true,
});

const CREATED: Property = {
  id: 'prop-created',
  name: 'Created',
  description: '',
  config: { type: 'created_time', format: 'full', timeFormat: 'viewer' },
  rowPage: 'always',
};

interface Setup {
  calendar?: Partial<CalendarOptions>;
  view?: Partial<View>;
  rows?: Row[];
  properties?: Property[];
  weekStart?: 0 | 1;
  readOnly?: boolean;
  nextCursor?: string | null;
}

function setup({
  calendar = {},
  view: patch = {},
  rows = jobsRows(),
  properties = jobsProperties(),
  weekStart = 0,
  readOnly = false,
  nextCursor = null,
}: Setup = {}) {
  const view: View = {
    ...defaultView('calendar', properties, { name: 'Calendar' }),
    id: 'view-calendar',
    calendar: { showBy: PROPS.due, mode: 'month', showWeekends: true, ...calendar },
    ...patch,
  };
  const meta = jobsDatabase({ properties, views: [view] });
  const props = layoutProps({
    meta,
    view,
    data: viewData(queryData(rows, { nextCursor })),
    viewer: testViewer({ weekStart }),
    readOnly,
  });
  render(<CalendarLayout {...props} />);
  return props;
}

const dayCell = (date: string): HTMLElement => {
  const cell = document.querySelector<HTMLElement>(
    `[data-testid="calendar-day"][data-date="${date}"]`,
  );
  if (!cell) throw new Error(`No day ${date}`);
  return cell;
};
const dates = () =>
  screen.getAllByTestId('calendar-day').map((cell) => cell.getAttribute('data-date'));
const cardIn = (date: string, title: string | RegExp) =>
  within(dayCell(date)).getByRole('button', { name: title });

function pointer(target: Element | Window, type: string, x: number, y: number) {
  fireEvent(
    target,
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  );
}
/**
 * A mouse drag from `from` to `to`, as the browser sends it: the moves land on what's under the
 * pointer, and a click follows the drop.
 */
function drag(from: Element, to: Element) {
  pointer(from, 'pointerdown', 10, 10);
  pointer(to, 'pointermove', 60, 40);
  pointer(to, 'pointermove', 120, 80);
  pointer(to, 'pointerup', 120, 80);
  fireEvent.click(to);
}

describe('the month grid', () => {
  it('shows October from Sunday, with today marked', () => {
    setup();
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeInTheDocument();
    expect(dates()[0]).toBe('2026-09-27');
    expect(dates().at(-1)).toBe('2026-10-31');
    expect(dates()).toHaveLength(35);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
    ]);
    expect(dayCell('2026-10-27')).toHaveAttribute('aria-current', 'date');
    expect(dayCell('2026-10-27')).toHaveAccessibleName('Tuesday, Oct 27, 2026');
    expect(dayCell('2026-10-28')).not.toHaveAttribute('aria-current');
  });

  it('starts weeks on Monday for a viewer who does', () => {
    setup({ weekStart: 1 });
    expect(dates()[0]).toBe('2026-09-28');
    expect(dates().at(-1)).toBe('2026-11-01');
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Mon');
  });

  it('leaves out weekends when Show weekends is off', () => {
    setup({ calendar: { showWeekends: false } });
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(dates()).not.toContain('2026-10-25');
    expect(dates()).not.toContain('2026-10-31');
    expect(dates()).toContain('2026-10-30');
  });

  it('goes to the next and previous month, and back to today', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument();
    expect(dates()).toContain('2026-11-30');
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeInTheDocument();
  });
});

describe('the week view', () => {
  it('shows the week holding today, from the week start', () => {
    setup({ calendar: { mode: 'week' }, weekStart: 1 });
    expect(screen.getByRole('grid', { name: 'Oct 26 – Nov 1, 2026' })).toBeInTheDocument();
    expect(dates()).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(dates()[0]).toBe('2026-11-02');
    expect(cardIn('2026-11-02', 'Replace water heater')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(dates()[0]).toBe('2026-10-26');
  });

  it('switches between Month and Week, and saves the choice', () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    expect(dates()).toHaveLength(7);
    expect(actions.updateView).toHaveBeenCalledWith({
      calendar: { showBy: PROPS.due, mode: 'week', showWeekends: true },
    });
  });
});

describe('rows on days', () => {
  it('puts each row on the day of its date and opens it on a click', () => {
    const { actions } = setup();
    fireEvent.click(cardIn('2026-10-28', 'Fix kitchen sink leak'));
    expect(actions.openRow).toHaveBeenCalledWith('row-sink');
    expect(cardIn('2026-10-20', 'Annual boiler service')).toBeInTheDocument();
    expect(within(dayCell('2026-10-27')).queryAllByRole('button', { name: /leak/ })).toHaveLength(
      0,
    );
  });

  it('shows a late evening in Denver on that evening, with its time', () => {
    setup({
      rows: [
        fixtureRow('row-late', 'Emergency call', 9, {
          [PROPS.due]: timed('2026-10-29T03:30:00.000Z'),
        }),
      ],
    });
    expect(cardIn('2026-10-28', '9:30 PM Emergency call')).toBeInTheDocument();
    expect(within(dayCell('2026-10-29')).queryByRole('button', { name: /Emergency/ })).toBeNull();
  });

  it('spans a 3-day range over 3 days', () => {
    setup({
      rows: [
        fixtureRow('row-range', 'Repipe the house', 9, {
          [PROPS.due]: day('2026-10-27', '2026-10-29'),
        }),
      ],
    });
    const days = screen
      .getAllByTestId('calendar-day')
      .filter((cell) => within(cell).queryByRole('button', { name: 'Repipe the house' }));
    expect(days.map((cell) => cell.getAttribute('data-date'))).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
    ]);
  });

  it('shows the properties the view shows on each card', () => {
    const view = defaultView('calendar', jobsProperties());
    setup({
      view: {
        properties: view.properties.map((s) => ({
          ...s,
          visible: s.propertyId === PROPS.status || s.visible,
        })),
      },
    });
    const card = dayCell('2026-10-28').querySelector<HTMLElement>('[data-row-id="row-sink"]');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('In progress')).toBeInTheDocument();
  });

  it('shows 3 items and "+N more", which opens the day\'s list', () => {
    const rows = ['Call back', 'Quote', 'Visit', 'Invoice', 'Follow up'].map((title, i) =>
      fixtureRow(`row-${i}`, title, 10 + i, { [PROPS.due]: day('2026-10-30') }),
    );
    setup({ rows });
    const cell = dayCell('2026-10-30');
    expect(
      within(cell).getAllByRole('button', { name: /^(Call back|Quote|Visit|Invoice|Follow up)$/ }),
    ).toHaveLength(3);
    fireEvent.click(within(cell).getByRole('button', { name: '+2 more' }));
    const list = screen.getByRole('dialog', { name: 'Friday, Oct 30, 2026' });
    expect(within(list).getByRole('button', { name: 'Follow up' })).toBeInTheDocument();
    expect(
      within(list).getAllByRole('button', { name: /^(Call back|Quote|Visit|Invoice|Follow up)$/ }),
    ).toHaveLength(5);
  });

  it('lists rows without a date under "No date"', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /No date/ }));
    const list = screen.getByRole('region', { name: 'No date' });
    expect(within(list).getByRole('button', { name: 'Unclog bathroom drain' })).toBeInTheDocument();
    expect(
      within(list).getByText('Drag a row onto a day to give it that date.'),
    ).toBeInTheDocument();
  });
});

describe('new on a day', () => {
  it('adds a row on the date of an empty day that was clicked', () => {
    const { actions } = setup();
    fireEvent.click(dayCell('2026-10-30'));
    expect(actions.createRow).toHaveBeenCalledWith({ values: { [PROPS.due]: day('2026-10-30') } });
  });

  it("adds one with Enter on a day, and from the day's New button", () => {
    const { actions } = setup();
    fireEvent.keyDown(dayCell('2026-10-27'), { key: 'Enter' });
    expect(actions.createRow).toHaveBeenLastCalledWith({
      values: { [PROPS.due]: day('2026-10-27') },
    });
    fireEvent.click(screen.getByRole('button', { name: 'New row on Monday, Oct 26, 2026' }));
    expect(actions.createRow).toHaveBeenLastCalledWith({
      values: { [PROPS.due]: day('2026-10-26') },
    });
    expect(actions.createRow).toHaveBeenCalledTimes(2);
  });

  it("doesn't add one from a click on a card", () => {
    const { actions } = setup();
    fireEvent.click(cardIn('2026-10-28', 'Fix kitchen sink leak'));
    expect(actions.createRow).not.toHaveBeenCalled();
  });
});

describe('moving', () => {
  it('moves a card to the day it is dropped on', () => {
    const { actions } = setup();
    drag(cardIn('2026-10-28', 'Fix kitchen sink leak'), dayCell('2026-10-30'));
    expect(actions.updateValues).toHaveBeenCalledWith('row-sink', {
      [PROPS.due]: day('2026-10-30'),
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      "Moved 'Fix kitchen sink leak' to Friday, Oct 30, 2026",
    );
    // The click after the drop neither adds a row nor opens one.
    expect(actions.createRow).not.toHaveBeenCalled();
    expect(actions.openRow).not.toHaveBeenCalled();
  });

  it("keeps a range's length when it is grabbed on any of its days", () => {
    const { actions } = setup({
      rows: [
        fixtureRow('row-range', 'Repipe the house', 9, {
          [PROPS.due]: day('2026-10-27', '2026-10-29'),
        }),
      ],
    });
    drag(cardIn('2026-10-28', 'Repipe the house'), dayCell('2026-10-31'));
    expect(actions.updateValues).toHaveBeenCalledWith('row-range', {
      [PROPS.due]: day('2026-10-30', '2026-11-01'),
    });
  });

  it('keeps the time of a timed row', () => {
    const { actions } = setup({
      rows: [
        fixtureRow('row-visit', 'Site visit', 9, {
          [PROPS.due]: timed('2026-10-27T21:30:00.000Z', '2026-10-27T22:30:00.000Z'),
        }),
      ],
    });
    drag(cardIn('2026-10-27', '3:30 PM Site visit'), dayCell('2026-10-29'));
    expect(actions.updateValues).toHaveBeenCalledWith('row-visit', {
      [PROPS.due]: timed('2026-10-29T21:30:00.000Z', '2026-10-29T22:30:00.000Z'),
    });
  });

  it('changes only the end when the end of a card is dragged', () => {
    const { actions } = setup();
    const card = dayCell('2026-10-28').querySelector('[data-row-id="row-sink"] [data-card-end]');
    if (!card) throw new Error('No end handle');
    drag(card, dayCell('2026-10-30'));
    expect(actions.updateValues).toHaveBeenCalledWith('row-sink', {
      [PROPS.due]: day('2026-10-28', '2026-10-30'),
    });
  });

  it('gives a row from "No date" the day it is dropped on', () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: /No date/ }));
    const list = screen.getByRole('region', { name: 'No date' });
    drag(
      within(list).getByRole('button', { name: 'Unclog bathroom drain' }),
      dayCell('2026-10-29'),
    );
    expect(actions.updateValues).toHaveBeenCalledWith('row-drain', {
      [PROPS.due]: day('2026-10-29'),
    });
  });

  it('does nothing for a press without a drag, or a drag let go of with Escape', () => {
    const { actions } = setup();
    const card = cardIn('2026-10-28', 'Fix kitchen sink leak');
    pointer(card, 'pointerdown', 10, 10);
    pointer(card, 'pointerup', 11, 11);
    pointer(card, 'pointerdown', 10, 10);
    pointer(dayCell('2026-10-30'), 'pointermove', 120, 80);
    fireEvent.keyDown(window, { key: 'Escape' });
    pointer(dayCell('2026-10-31'), 'pointermove', 200, 80);
    pointer(dayCell('2026-10-31'), 'pointerup', 200, 80);
    fireEvent.click(dayCell('2026-10-31'));
    expect(actions.updateValues).not.toHaveBeenCalled();
    expect(actions.createRow).not.toHaveBeenCalled();
  });

  it('moves a card with "Move to date" in its menu', () => {
    const { actions } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Card menu for Fix kitchen sink leak' }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to date' }));
    const dialog = screen.getByRole('dialog', { name: 'Move to date' });
    const input = within(dialog).getByLabelText('Date');
    expect(input).toHaveValue('2026-10-28');
    fireEvent.change(input, { target: { value: '2026-11-03' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(actions.updateValues).toHaveBeenCalledWith('row-sink', {
      [PROPS.due]: day('2026-11-03'),
    });
    expect(screen.queryByRole('dialog', { name: 'Move to date' })).toBeNull();
  });

  it('opens and deletes rows from the card menu', () => {
    const { actions } = setup();
    const menu = () => screen.getByRole('button', { name: 'Card menu for Fix kitchen sink leak' });
    fireEvent.keyDown(menu(), { key: 'Enter' });
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Open',
      'Move to date',
      'Delete',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(actions.trashRows).toHaveBeenCalledWith(['row-sink']);
  });
});

describe('when dates cannot change', () => {
  it('lets a read-only viewer look but not add or move', () => {
    const { actions } = setup({ readOnly: true });
    fireEvent.click(dayCell('2026-10-30'));
    drag(cardIn('2026-10-28', 'Fix kitchen sink leak'), dayCell('2026-10-30'));
    expect(actions.createRow).not.toHaveBeenCalled();
    expect(actions.updateValues).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Card menu for Fix kitchen sink leak' }), {
      key: 'Enter',
    });
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open']);
  });

  it('shows rows by created time without dragging them', () => {
    const { actions } = setup({
      properties: [...jobsProperties(), CREATED],
      calendar: { showBy: CREATED.id },
    });
    // Every fixture row was made on Oct 20 at 10 AM in Denver.
    const card = cardIn('2026-10-20', '10:00 AM Fix kitchen sink leak');
    drag(card, dayCell('2026-10-22'));
    fireEvent.click(dayCell('2026-10-22'));
    expect(actions.updateValues).not.toHaveBeenCalled();
    expect(actions.createRow).not.toHaveBeenCalled();
  });

  it('asks for a date property when the view has none to show by', () => {
    const { actions } = setup({ calendar: { showBy: null } });
    expect(screen.getByText('Pick a date property to show rows by.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Show by' });
    fireEvent.click(button);
    expect(actions.openPanel).toHaveBeenCalledWith('layout', undefined, button);
    expect(screen.queryByTestId('calendar-day')).toBeNull();
  });
});

describe('the keyboard', () => {
  it('moves between days with the arrow keys, into the next month', () => {
    setup();
    const today = dayCell('2026-10-27');
    expect(today).toHaveAttribute('tabindex', '0');
    act(() => today.focus());
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(dayCell('2026-10-28'));
    fireEvent.keyDown(dayCell('2026-10-28'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(dayCell('2026-11-04'));
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument();
  });
});

describe('long views', () => {
  it('loads the next page with Load more', () => {
    const { actions } = setup({ nextCursor: 'cursor-2' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(actions.loadMore).toHaveBeenCalledWith();
  });
});
