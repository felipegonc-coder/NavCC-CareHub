import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultView,
  type DateValue,
  type Property,
  type Row,
  type TimelineOptions,
  type View,
} from '@carehub/databases';
import { SHIFT_LIMIT_MESSAGE } from '@carehub/databases/dependencies';
import { ToastProvider } from '@carehub/ui';
import {
  fixtureRow,
  groupedByStatus,
  JOBS_ID,
  jobsDatabase,
  jobsProperties,
  jobsRows,
  layoutProps,
  PROPS,
  queryData,
  testViewer,
  viewData,
} from '../test-utils';
import TimelineLayout from './layout';
import { Notice } from './notice';

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
const dateProperty = (id: string, name: string): Property => ({
  id,
  name,
  description: '',
  config: { type: 'date', format: 'full', timeFormat: 'viewer' },
  rowPage: 'always',
});
const relation = (id: string, name: string, pair: string): Property => ({
  id,
  name,
  description: '',
  config: { type: 'relation', targetDatabaseId: JOBS_ID, single: false, twoWayPropertyId: pair },
  rowPage: 'always',
});
const FINISH = dateProperty('prop-finish', 'Finish');
const BLOCKED_BY = relation('prop-blocked-by', 'Blocked by', 'prop-blocking');
const BLOCKING = relation('prop-blocking', 'Blocking', 'prop-blocked-by');

interface Setup {
  timeline?: Partial<TimelineOptions>;
  rows?: Row[];
  properties?: Property[];
  grouped?: boolean;
  dependencies?: boolean;
  readOnly?: boolean;
  nextCursor?: string | null;
}

function setup({
  timeline = {},
  rows = jobsRows(),
  properties = jobsProperties(),
  grouped = false,
  dependencies = false,
  readOnly = false,
  nextCursor = null,
}: Setup = {}) {
  const view: View = {
    ...defaultView('timeline', properties, { name: 'Timeline' }),
    id: 'view-timeline',
    timeline: {
      showBy: PROPS.due,
      endBy: null,
      scale: 'week',
      showTable: true,
      tableProperties: [],
      ...timeline,
    },
  };
  const meta = jobsDatabase({
    properties,
    views: [view],
    dependencies: dependencies
      ? { blockedByPropertyId: BLOCKED_BY.id, blockingPropertyId: BLOCKING.id, shift: 'shift' }
      : null,
  });
  const props = layoutProps({
    meta,
    view,
    data: viewData(grouped ? groupedByStatus(rows) : queryData(rows, { nextCursor })),
    viewer: testViewer(),
    readOnly,
  });
  render(<TimelineLayout {...props} />);
  return props;
}

const bar = (rowId: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(
    `[data-testid="timeline-bar"][data-row-id="${rowId}"]`,
  );
  if (!found) throw new Error(`No bar for ${rowId}`);
  return found;
};
const edge = (rowId: string, side: 'start' | 'end'): HTMLElement => {
  const found = bar(rowId).querySelector<HTMLElement>(`[data-bar-edge="${side}"]`);
  if (!found) throw new Error(`No ${side} handle on ${rowId}`);
  return found;
};
/** Where a bar (or the Today line) is drawn and how wide, px. */
const leftOf = (element: HTMLElement) => Number.parseFloat(element.style.left);
const widthOf = (element: HTMLElement) => Number.parseFloat(element.style.width);
const shownBars = () =>
  screen.getAllByTestId('timeline-bar').map((b) => b.getAttribute('data-row-id'));

function pointer(target: Element, type: string, x: number) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x }));
}
/** A mouse drag `dx` px sideways, as the browser sends it: a click follows the drop. */
function drag(target: Element, dx: number) {
  pointer(target, 'pointerdown', 100);
  pointer(target, 'pointermove', 100 + dx / 2);
  pointer(target, 'pointermove', 100 + dx);
  pointer(target, 'pointerup', 100 + dx);
  fireEvent.click(target);
}

beforeEach(() => window.localStorage.clear());

// The week scale is 60 px a day. With the Jobs rows (Oct 20 to Nov 2) and today Oct 27, it
// starts on Sunday, Oct 4.

describe('bars', () => {
  it('draws a bar for each row with a date, and lists the others under "No date"', () => {
    setup();
    expect(shownBars()).toEqual(['row-sink', 'row-heater', 'row-boiler']);
    expect(bar('row-sink')).toHaveAccessibleName('Fix kitchen sink leak');
    expect(leftOf(bar('row-sink'))).toBe(1440);
    expect(widthOf(bar('row-sink'))).toBe(60);
    const table = screen.getByRole('table', { name: 'Rows' });
    const titles = within(table)
      .getAllByRole('row')
      .map((r) => r.textContent);
    expect(titles).toEqual([
      'Name',
      'Fix kitchen sink leak',
      'Replace water heater',
      'Annual boiler service',
      'No date 1',
      'Unclog bathroom drain',
    ]);
  });

  it('opens a row from its bar or its title', () => {
    const { actions } = setup();
    fireEvent.click(bar('row-heater'));
    expect(actions.openRow).toHaveBeenCalledWith('row-heater');
    const table = screen.getByRole('table', { name: 'Rows' });
    fireEvent.click(within(table).getByRole('button', { name: 'Annual boiler service' }));
    expect(actions.openRow).toHaveBeenCalledWith('row-boiler');
  });

  it('spans a range over its days', () => {
    setup({
      rows: [
        fixtureRow('row-range', 'Repipe the house', 5, {
          [PROPS.due]: day('2026-10-27', '2026-10-29'),
        }),
      ],
    });
    expect(widthOf(bar('row-range'))).toBe(180);
  });

  it('reads the start and end from two properties', () => {
    setup({
      properties: [...jobsProperties(), FINISH],
      rows: [
        fixtureRow('row-sink', 'Fix kitchen sink leak', 1, {
          [PROPS.due]: day('2026-10-28'),
          [FINISH.id]: day('2026-10-30'),
        }),
      ],
      timeline: { endBy: FINISH.id },
    });
    expect(widthOf(bar('row-sink'))).toBe(180);
  });

  it('shows a late evening in Denver on that evening', () => {
    // 9:30 PM on Oct 27 in Denver. The Day scale is 120 px a day, from a week before: Oct 20.
    setup({
      rows: [
        fixtureRow('row-late', 'Night call', 5, { [PROPS.due]: timed('2026-10-28T03:30:00.000Z') }),
      ],
      timeline: { scale: 'day' },
    });
    expect(leftOf(bar('row-late'))).toBe(7 * 120 + (21.5 / 24) * 120);
  });

  it('shows the table properties, and hides the table with Show table off', () => {
    setup({ timeline: { tableProperties: [{ propertyId: PROPS.status, visible: true }] } });
    const table = screen.getByRole('table', { name: 'Rows' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Name', 'Status']);
  });

  it('draws the bars alone without the table, naming rows without dates on their line', () => {
    setup({ timeline: { showTable: false } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(shownBars()).toHaveLength(3);
    expect(screen.getByText('No date')).toBeInTheDocument();
    expect(screen.getByText('Unclog bathroom drain')).toBeInTheDocument();
  });

  it('shows only the bars on a phone', () => {
    const original = window.matchMedia;
    window.matchMedia = ((media: string) => ({
      matches: true,
      media,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      setup();
      expect(screen.queryByRole('table')).toBeNull();
      expect(shownBars()).toHaveLength(3);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('scales', () => {
  it.each([
    ['hours', 'Tue, Oct 27', '3 PM'],
    ['day', 'October 2026', 'Tue 27'],
    ['week', 'October 2026', '27'],
    ['bi_week', 'October 2026', 'Oct 25'],
    ['month', 'October 2026', 'Oct 25'],
    ['quarter', 'Q4 2026', 'Oct'],
    ['year', '2026', 'Oct'],
  ] as const)('labels the %s scale', (scale, top, bottom) => {
    setup({ timeline: { scale } });
    expect(screen.getAllByText(top).length).toBeGreaterThan(0);
    expect(screen.getAllByText(bottom).length).toBeGreaterThan(0);
  });

  it('draws the Today line at now', () => {
    setup();
    // 9 AM on Oct 27 in Denver: 23 days and 9 hours in.
    expect(leftOf(screen.getByTestId('timeline-today'))).toBe(1402.5);
  });

  it('zooms with the Zoom menu and saves the choice', () => {
    const { actions } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Zoom Week' }), { key: 'Enter' });
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Hours',
      'Day',
      'Week',
      'Bi-week',
      'Month',
      'Quarter',
      'Year',
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Month' }));
    expect(actions.updateView).toHaveBeenCalledWith({
      timeline: expect.objectContaining({ scale: 'month' }),
    });
    expect(screen.getByRole('button', { name: 'Zoom Month' })).toBeInTheDocument();
    // A month is 12 px a day.
    expect(widthOf(bar('row-sink'))).toBe(12);
  });

  it('has Today, Earlier and Later', () => {
    setup();
    for (const name of ['Today', 'Earlier', 'Later']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(shownBars()).toHaveLength(3);
  });
});

describe('moving', () => {
  it('moves a bar by whole days when it is dragged', () => {
    const { actions } = setup();
    drag(bar('row-sink'), 120);
    expect(actions.updateValues).toHaveBeenCalledWith('row-sink', {
      [PROPS.due]: day('2026-10-30'),
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      "Moved 'Fix kitchen sink leak' to Oct 30, 2026",
    );
    // The click after the drop doesn't open the row.
    expect(actions.openRow).not.toHaveBeenCalled();
  });

  it('changes the end or the start when an end is dragged', () => {
    const { actions } = setup();
    drag(edge('row-sink', 'end'), 120);
    expect(actions.updateValues).toHaveBeenLastCalledWith('row-sink', {
      [PROPS.due]: day('2026-10-28', '2026-10-30'),
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      "'Fix kitchen sink leak' now ends Oct 30, 2026",
    );
    drag(edge('row-heater', 'start'), -60);
    expect(actions.updateValues).toHaveBeenLastCalledWith('row-heater', {
      [PROPS.due]: day('2026-11-01', '2026-11-02'),
    });
  });

  it('moves separate start and end properties together, or the end alone', () => {
    const { actions } = setup({
      properties: [...jobsProperties(), FINISH],
      rows: [
        fixtureRow('row-sink', 'Fix kitchen sink leak', 1, {
          [PROPS.due]: day('2026-10-28'),
          [FINISH.id]: day('2026-10-30'),
        }),
      ],
      timeline: { endBy: FINISH.id },
    });
    drag(bar('row-sink'), 60);
    expect(actions.updateValues).toHaveBeenLastCalledWith('row-sink', {
      [PROPS.due]: day('2026-10-29'),
      [FINISH.id]: day('2026-10-31'),
    });
    drag(edge('row-sink', 'end'), 60);
    expect(actions.updateValues).toHaveBeenLastCalledWith('row-sink', {
      [FINISH.id]: day('2026-10-31'),
    });
  });

  it('moves times by 15 minutes on the Hours scale', () => {
    // 40 px an hour: 30 px is 45 minutes.
    const { actions } = setup({
      rows: [
        fixtureRow('row-visit', 'Site visit', 5, {
          [PROPS.due]: timed('2026-10-28T15:00:00.000Z', '2026-10-28T16:00:00.000Z'),
        }),
      ],
      timeline: { scale: 'hours' },
    });
    drag(bar('row-visit'), 30);
    expect(actions.updateValues).toHaveBeenCalledWith('row-visit', {
      [PROPS.due]: timed('2026-10-28T15:45:00.000Z', '2026-10-28T16:45:00.000Z'),
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      "Moved 'Site visit' to Oct 28, 2026 9:45 AM",
    );
  });

  it('does nothing for a press without a drag, or a drag called off with Escape', () => {
    const { actions } = setup();
    pointer(bar('row-sink'), 'pointerdown', 100);
    pointer(bar('row-sink'), 'pointerup', 101);
    fireEvent.click(bar('row-sink'));
    expect(actions.openRow).toHaveBeenCalledWith('row-sink');
    pointer(bar('row-sink'), 'pointerdown', 100);
    pointer(bar('row-sink'), 'pointermove', 220);
    fireEvent.keyDown(window, { key: 'Escape' });
    pointer(bar('row-sink'), 'pointermove', 340);
    pointer(bar('row-sink'), 'pointerup', 340);
    fireEvent.click(bar('row-sink'));
    expect(actions.updateValues).not.toHaveBeenCalled();
    expect(actions.openRow).toHaveBeenCalledTimes(1);
  });

  it('picks a bar up with Space, moves it with the arrow keys and drops it', () => {
    const { actions } = setup();
    const sink = bar('row-sink');
    fireEvent.keyDown(sink, { key: ' ' });
    expect(screen.getByRole('status')).toHaveTextContent(
      "Picked up 'Fix kitchen sink leak'. Use the arrow keys to move it, Shift and the arrow keys to change its end, and Space to drop it.",
    );
    fireEvent.keyDown(sink, { key: 'ArrowRight' });
    fireEvent.keyDown(sink, { key: 'ArrowRight' });
    fireEvent.keyDown(sink, { key: 'ArrowRight', shiftKey: true });
    expect(leftOf(sink)).toBe(1560);
    expect(widthOf(sink)).toBe(120);
    fireEvent.keyDown(sink, { key: ' ' });
    expect(actions.updateValues).toHaveBeenCalledWith('row-sink', {
      [PROPS.due]: day('2026-10-30', '2026-10-31'),
    });
  });

  it('puts a picked-up bar back with Escape, and opens rows with Enter', () => {
    const { actions } = setup();
    const sink = bar('row-sink');
    fireEvent.keyDown(sink, { key: ' ' });
    fireEvent.keyDown(sink, { key: 'ArrowLeft' });
    fireEvent.keyDown(sink, { key: 'Escape' });
    expect(screen.getByRole('status')).toHaveTextContent(
      "'Fix kitchen sink leak' stays where it was.",
    );
    expect(leftOf(sink)).toBe(1440);
    fireEvent.keyDown(sink, { key: ' ' });
    fireEvent.keyDown(sink, { key: ' ' });
    expect(screen.getByRole('status')).toHaveTextContent("Dropped 'Fix kitchen sink leak'.");
    expect(actions.updateValues).not.toHaveBeenCalled();
    fireEvent.keyDown(sink, { key: 'Enter' });
    expect(actions.openRow).toHaveBeenCalledWith('row-sink');
  });

  it('goes from bar to bar with the up and down arrows', () => {
    setup();
    bar('row-sink').focus();
    fireEvent.keyDown(bar('row-sink'), { key: 'ArrowDown' });
    expect(bar('row-heater')).toHaveFocus();
    fireEvent.keyDown(bar('row-heater'), { key: 'ArrowUp' });
    expect(bar('row-sink')).toHaveFocus();
  });

  it('places a row without dates on the day its empty line is clicked, or today', () => {
    const { actions } = setup();
    const line = screen.getByRole('button', {
      name: 'Place Unclog bathroom drain on the timeline',
    });
    fireEvent.click(line, { clientX: 185 });
    expect(actions.updateValues).toHaveBeenLastCalledWith('row-drain', {
      [PROPS.due]: day('2026-10-07'),
    });
    fireEvent.keyDown(line, { key: 'Enter' });
    expect(actions.updateValues).toHaveBeenLastCalledWith('row-drain', {
      [PROPS.due]: day('2026-10-27'),
    });
  });

  it('lets a read-only viewer look but not move', () => {
    const { actions } = setup({ readOnly: true });
    drag(bar('row-sink'), 120);
    fireEvent.keyDown(bar('row-heater'), { key: ' ' });
    expect(actions.updateValues).not.toHaveBeenCalled();
    expect(actions.openRow).toHaveBeenCalledWith('row-heater');
    expect(screen.queryByRole('button', { name: /^Place / })).toBeNull();
    expect(document.querySelector('[data-bar-edge]')).toBeNull();
  });
});

describe('groups', () => {
  it('collapses and expands groups', () => {
    setup({ grouped: true });
    expect(shownBars()).toEqual(['row-heater', 'row-sink', 'row-boiler']);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse In progress' }));
    expect(shownBars()).toEqual(['row-heater', 'row-boiler']);
    const expand = screen.getByRole('button', { name: 'Expand In progress' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expand);
    expect(shownBars()).toEqual(['row-heater', 'row-sink', 'row-boiler']);
  });
});

describe('dependencies', () => {
  const rows = () => {
    const list = jobsRows().map((row) =>
      row.id === 'row-heater'
        ? { ...row, values: { ...row.values, [BLOCKED_BY.id]: ['row-sink'] } }
        : row,
    );
    return [
      ...list,
      fixtureRow('row-pipe', 'Repipe the house', 5, {
        [PROPS.due]: day('2026-11-01', '2026-11-03'),
        [BLOCKING.id]: ['row-heater'],
      }),
    ];
  };
  const properties = () => [...jobsProperties(), BLOCKED_BY, BLOCKING];

  it('draws arrows from blocking rows to the rows they block, red when they overlap', () => {
    setup({
      rows: rows(),
      properties: properties(),
      dependencies: true,
      timeline: { showDependencies: true },
    });
    const arrows = screen.getAllByTestId('timeline-arrow');
    expect(
      arrows.map((a) => ['from', 'to', 'conflict'].map((name) => a.getAttribute(`data-${name}`))),
    ).toEqual([
      ['row-sink', 'row-heater', 'false'],
      ['row-pipe', 'row-heater', 'true'],
    ]);
  });

  it('draws no arrows with Show dependencies off', () => {
    setup({ rows: rows(), properties: properties(), dependencies: true });
    expect(screen.queryAllByTestId('timeline-arrow')).toEqual([]);
  });

  it('shifts a blocked row when its blocker moves into it', () => {
    const { actions } = setup({ rows: rows(), properties: properties(), dependencies: true });
    drag(bar('row-sink'), 360);
    expect(actions.updateValues).toHaveBeenCalledWith('row-sink', {
      [PROPS.due]: day('2026-11-03'),
    });
    expect(actions.updateValues).toHaveBeenCalledWith('row-heater', {
      [PROPS.due]: day('2026-11-08'),
    });
  });

  it('says so when too many rows would shift', () => {
    const onShown = vi.fn();
    render(
      <ToastProvider>
        <Notice text={SHIFT_LIMIT_MESSAGE} onShown={onShown} />
      </ToastProvider>,
    );
    expect(screen.getByText(SHIFT_LIMIT_MESSAGE)).toBeInTheDocument();
    expect(onShown).toHaveBeenCalledTimes(1);
  });
});

describe('messages', () => {
  it('asks for a date property when the view has none to show by', () => {
    const { actions } = setup({ timeline: { showBy: null } });
    expect(screen.getByText('Pick a date property to show rows by.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Show by' });
    fireEvent.click(button);
    expect(actions.openPanel).toHaveBeenCalledWith('layout', undefined, button);
    expect(screen.queryByTestId('timeline-bar')).toBeNull();
  });

  it('loads the next page with Load more', () => {
    const { actions } = setup({ nextCursor: 'next' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(actions.loadMore).toHaveBeenCalledTimes(1);
  });
});
