import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@carehub/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileRef, Property, View } from '@carehub/databases';
import type { LayoutProps, QueryLane, ViewData } from '../contract';
import {
  fixtureRow,
  groupedByStatus,
  jobsDatabase,
  jobsProperties,
  jobsRows,
  layoutProps,
  PRIORITY,
  PROPS,
  queryData,
  STATUS,
  viewData,
  VIEWS,
} from '../test-utils';
import BoardLayout from './layout';
import { PHONE } from './model';

function boardView(patch: Partial<View> = {}): View {
  const view = jobsDatabase().views.find((v) => v.id === VIEWS.board);
  if (!view) throw new Error('The fixture needs a board view.');
  return { ...view, ...patch };
}

function renderBoard(overrides: Partial<Omit<LayoutProps, 'actions'>> = {}) {
  const props = layoutProps({ view: boardView(), ...overrides });
  const board = (next: LayoutProps) => (
    <ToastProvider>
      <BoardLayout {...next} />
    </ToastProvider>
  );
  const result = render(board(props));
  return {
    ...result,
    props,
    actions: props.actions,
    redraw: (patch: Partial<LayoutProps>) => result.rerender(board({ ...props, ...patch })),
  };
}

const column = (groupKey: string, laneKey?: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('[data-testid="board-column"]')].find(
    (el) => el.dataset.groupKey === groupKey && el.dataset.laneKey === laneKey,
  );
  if (!found) throw new Error(`No column ${groupKey} ${laneKey ?? ''}`);
  return found;
};
const cardsIn = (el: HTMLElement) =>
  [...el.querySelectorAll('article[data-row-id]')].map((a) => a.getAttribute('data-row-id'));
const card = (rowId: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`article[data-row-id="${rowId}"]`);
  if (!found) throw new Error(`No card ${rowId}`);
  return found;
};
const opener = (rowId: string): HTMLElement => {
  const found = card(rowId).querySelector<HTMLElement>('[data-card-open]');
  if (!found) throw new Error(`No title on ${rowId}`);
  return found;
};

const rect = (x: number, y: number, width: number, height: number) =>
  ({
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({}),
  }) as DOMRect;

/** jsdom draws nothing: columns stand 300 px apart, and cards 60 px apart from y 40. */
function layOutBoard() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const slots = [...document.querySelectorAll('[data-board-slot]')];
    const at = slots.indexOf(this);
    if (at >= 0) return rect(at * 300, 0, 280, 600);
    const slot = this.closest('[data-board-slot]');
    if (slot && this.matches('article[data-row-id]')) {
      const index = [...slot.querySelectorAll('article[data-row-id]')].indexOf(this);
      return rect(slots.indexOf(slot) * 300, 40 + index * 60, 280, 50);
    }
    return rect(0, 0, 0, 0);
  });
}

function pointer(target: Element | Window, type: string, x: number, y: number) {
  fireEvent(
    target,
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('BoardLayout columns', () => {
  it('draws a column per group with its label, count, colour and cards', () => {
    renderBoard();
    const keys = screen.getAllByTestId('board-column').map((el) => el.dataset.groupKey);
    expect(keys).toEqual([STATUS.notStarted, STATUS.inProgress, STATUS.done]);
    const notStarted = column(STATUS.notStarted);
    expect(within(notStarted).getByText('Not started')).toHaveClass('text-gray-text');
    expect(within(notStarted).getByText('2')).toBeInTheDocument();
    expect(cardsIn(notStarted)).toEqual(['row-heater', 'row-drain']);
    expect(column(STATUS.done)).toHaveClass('bg-green-bg');
    expect(screen.getByRole('article', { name: 'Fix kitchen sink leak' })).toHaveAttribute(
      'data-row-id',
      'row-sink',
    );
  });

  it("shows the column's calculation instead of the count when the board sets one", () => {
    const data = groupedByStatus();
    const groups = (data.groups ?? []).map((g) =>
      g.key === STATUS.notStarted
        ? { ...g, header: { value: { kind: 'number' as const, value: 1450 }, text: '$1,450.00' } }
        : g,
    );
    renderBoard({ data: viewData({ ...data, groups }) });
    expect(within(column(STATUS.notStarted)).getByText('$1,450.00')).toBeInTheDocument();
    expect(within(column(STATUS.notStarted)).queryByText('2')).toBeNull();
  });

  it('shows the properties the view puts on cards, skipping empty ones', () => {
    const view = boardView({
      properties: [
        { propertyId: PROPS.name, visible: true },
        { propertyId: PROPS.priority, visible: true },
        { propertyId: PROPS.due, visible: true },
      ],
    });
    renderBoard({ view });
    expect(within(card('row-sink')).getByText('High')).toBeInTheDocument();
    expect(card('row-sink').querySelector(`[data-property-id="${PROPS.due}"]`)).not.toBeNull();
    expect(card('row-drain').querySelector(`[data-property-id="${PROPS.due}"]`)).toBeNull();
  });

  it('shows a picture from a Files property, fitted, on large cards', () => {
    const photos: Property = {
      id: 'prop-photos',
      name: 'Photos',
      description: '',
      config: { type: 'files' },
      rowPage: 'always',
    };
    const meta = jobsDatabase({ properties: [...jobsProperties(), photos] });
    const photo: FileRef = { id: 'file-sink', name: 'leak.jpg', size: 2048, mime: 'image/jpeg' };
    const rows = jobsRows().map((r) =>
      r.id === 'row-sink' ? { ...r, values: { ...r.values, [photos.id]: [photo] } } : r,
    );
    const view = boardView({
      board: {
        cardPreview: { kind: 'files', propertyId: photos.id },
        cardSize: 'l',
        fitImage: true,
        colorColumns: false,
      },
    });
    renderBoard({ meta, view, data: viewData(groupedByStatus(rows)) });
    const picture = card('row-sink').querySelector('img');
    expect(picture).toHaveAttribute('src', '/api/files/file-sink');
    expect(picture).toHaveClass('object-contain', 'h-48');
    expect(card('row-heater').querySelector('img')).toBeNull();
    expect(column(STATUS.done)).toHaveClass('bg-fill');
  });

  it('collapses a column and remembers it for this person', () => {
    const first = renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Done' }));
    expect(cardsIn(column(STATUS.done))).toEqual([]);
    // It stands narrow, its label on its side.
    expect(column(STATUS.done)).toHaveClass('w-10');
    expect(within(column(STATUS.done)).getByText('Done').style.writingMode).toBe('vertical-rl');
    first.unmount();
    renderBoard();
    expect(screen.getByRole('button', { name: 'Expand Done' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(cardsIn(column(STATUS.done))).toEqual([]);
  });

  it('lists hidden groups at the end, with Show', () => {
    const data = groupedByStatus();
    const groups = (data.groups ?? []).map((g) =>
      g.key === STATUS.done ? { ...g, hidden: true, rows: [] } : g,
    );
    const view = boardView({ grouping: { propertyId: PROPS.status, hidden: [STATUS.done] } });
    const { actions } = renderBoard({ view, data: viewData({ ...data, groups }) });
    const keys = screen.getAllByTestId('board-column').map((el) => el.dataset.groupKey);
    expect(keys).toEqual([STATUS.notStarted, STATUS.inProgress]);
    const hidden = screen.getByRole('region', { name: 'Hidden groups' });
    expect(within(hidden).getByText('Done')).toBeInTheDocument();
    expect(within(hidden).getByText('1')).toBeInTheDocument();
    fireEvent.click(within(hidden).getByRole('button', { name: 'Show Done' }));
    expect(actions.updateView).toHaveBeenCalledWith({
      grouping: { propertyId: PROPS.status, hidden: [] },
    });
  });

  it('leaves out columns without cards when the view hides empty groups', () => {
    const data = groupedByStatus();
    const groups = (data.groups ?? []).map((g) =>
      g.key === STATUS.done ? { ...g, count: 0, rows: [] } : g,
    );
    const view = boardView({ grouping: { propertyId: PROPS.status, hideEmpty: true } });
    renderBoard({ view, data: viewData({ ...data, groups }) });
    const keys = screen.getAllByTestId('board-column').map((el) => el.dataset.groupKey);
    expect(keys).toEqual([STATUS.notStarted, STATUS.inProgress]);
  });

  it("hides a column and moves it left or right from the column's menu", () => {
    const { actions } = renderBoard();
    const items = () => screen.getAllByRole('menuitem').map((item) => item.textContent);
    fireEvent.click(screen.getByRole('button', { name: 'Column menu for Not started' }));
    expect(items()).toEqual(['Hide', 'Move right', 'Calculate']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move right' }));
    expect(actions.updateView).toHaveBeenLastCalledWith({
      grouping: {
        propertyId: PROPS.status,
        sort: 'manual',
        order: [STATUS.inProgress, STATUS.notStarted, STATUS.done],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Column menu for Done' }));
    expect(items()).toEqual(['Hide', 'Move left', 'Calculate']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide' }));
    expect(actions.updateView).toHaveBeenLastCalledWith({
      grouping: { propertyId: PROPS.status, hidden: [STATUS.done] },
    });
  });

  it('sets the calculation every column header shows', () => {
    const { actions, props } = renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Column menu for In progress' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Calculate' }));
    expect(screen.getByRole('menuitemradio', { name: 'Count all' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cost' }));
    const choices = screen.getAllByRole('menuitemradio').map((item) => item.textContent);
    expect(choices).toContain('Sum');
    expect(choices).not.toContain('Count all');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Sum' }));
    expect(actions.updateView).toHaveBeenCalledWith({
      board: expect.objectContaining({
        cardSize: props.view.board?.cardSize ?? 'm',
        headerCalculation: { propertyId: PROPS.cost, aggregate: 'sum' },
      }),
    });
  });

  it("doesn't offer Calculate to people who can't change the view for everyone", () => {
    renderBoard({ readOnly: true });
    fireEvent.click(screen.getByRole('button', { name: 'Column menu for Done' }));
    expect(screen.queryByRole('menuitem', { name: 'Calculate' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Hide' })).toBeInTheDocument();
  });

  it('"Load more" asks for the next page of that column', () => {
    const data = groupedByStatus();
    const groups = (data.groups ?? []).map((g) =>
      g.key === STATUS.notStarted ? { ...g, count: 30, nextCursor: 'cursor-2' } : g,
    );
    const { actions, redraw, props } = renderBoard({ data: viewData({ ...data, groups }) });
    expect(within(column(STATUS.done)).queryByRole('button', { name: 'Load more' })).toBeNull();
    fireEvent.click(within(column(STATUS.notStarted)).getByRole('button', { name: 'Load more' }));
    expect(actions.loadMore).toHaveBeenCalledWith(STATUS.notStarted);
    redraw({ data: { ...props.data, loadingMore: [STATUS.notStarted] } });
    expect(
      within(column(STATUS.notStarted)).getByRole('button', { name: 'Load more' }),
    ).toHaveAttribute('aria-busy', 'true');
  });
});

describe('BoardLayout cards', () => {
  it('opens a card on click and with Enter', () => {
    const { actions } = renderBoard();
    fireEvent.click(opener('row-sink'));
    expect(actions.openRow).toHaveBeenCalledWith('row-sink');
    fireEvent.keyDown(opener('row-boiler'), { key: 'Enter' });
    expect(actions.openRow).toHaveBeenLastCalledWith('row-boiler');
  });

  it('"+ New" in a column makes a row there and edits its title in place', async () => {
    const { actions, redraw } = renderBoard();
    fireEvent.click(within(column(STATUS.done)).getByRole('button', { name: 'New' }));
    expect(actions.createRow).toHaveBeenCalledWith({ groupKey: STATUS.done });
    const input = await within(column(STATUS.done)).findByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: 'Call back Blue Pine Plumbing' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.updateValues).toHaveBeenCalledWith('row-new', {
      [PROPS.name]: 'Call back Blue Pine Plumbing',
    });
    const made = within(column(STATUS.done)).getByRole('article', {
      name: 'Call back Blue Pine Plumbing',
    });
    expect(within(made).queryByText('Hidden by filter')).toBeNull();
    // A newer answer without it: it stays, marked.
    redraw({ data: viewData(groupedByStatus()) });
    expect(within(card('row-new')).getByText('Hidden by filter')).toBeInTheDocument();
  });

  it('offers nothing that changes rows when read-only', () => {
    renderBoard({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Card menu for Replace water heater' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Open', 'Copy link']);
  });
});

describe('BoardLayout moves', () => {
  it('moves a card with "Move to…" in its menu', () => {
    const { actions } = renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Card menu for Replace water heater' }));
    const items = () => screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items()).toEqual(['Open', 'Move to…', 'Duplicate', 'Copy link', 'Delete']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
    expect(items()).toEqual(['In progress', 'Done']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Done' }));
    expect(actions.moveRow).toHaveBeenCalledWith('row-heater', {
      beforeRowId: 'row-boiler',
      fromGroupKey: STATUS.notStarted,
      toGroupKey: STATUS.done,
    });
    expect(screen.getByText("Moved 'Replace water heater' to Done")).toBeInTheDocument();
  });

  it('moves a card by keyboard: Space picks it up, arrows move it, Space drops it', () => {
    const { actions } = renderBoard();
    const heater = opener('row-heater');
    heater.focus();
    fireEvent.keyDown(heater, { key: ' ' });
    expect(screen.getByText(/^Picked up 'Replace water heater'/)).toBeInTheDocument();
    expect(card('row-heater')).toHaveClass('ring-2');
    fireEvent.keyDown(heater, { key: 'ArrowRight' });
    expect(screen.getByText('In progress, 1 of 2')).toBeInTheDocument();
    fireEvent.keyDown(heater, { key: 'ArrowDown' });
    expect(screen.getByText('In progress, 2 of 2')).toBeInTheDocument();
    expect(column(STATUS.inProgress).querySelector('[data-drop-indicator]')).not.toBeNull();
    fireEvent.keyDown(heater, { key: ' ' });
    expect(actions.moveRow).toHaveBeenCalledWith('row-heater', {
      beforeRowId: null,
      fromGroupKey: STATUS.notStarted,
      toGroupKey: STATUS.inProgress,
    });
    expect(screen.getByText("Moved 'Replace water heater' to In progress")).toBeInTheDocument();
  });

  it('Escape puts a picked-up card back; Shift+F10 opens its menu', () => {
    const { actions } = renderBoard();
    const heater = opener('row-heater');
    fireEvent.keyDown(heater, { key: ' ' });
    fireEvent.keyDown(heater, { key: 'ArrowRight' });
    fireEvent.keyDown(heater, { key: 'Escape' });
    expect(actions.moveRow).not.toHaveBeenCalled();
    expect(
      screen.getByText("Move cancelled. 'Replace water heater' is back where it was."),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-drop-indicator]')).toBeNull();
    fireEvent.keyDown(heater, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menuitem', { name: 'Move to…' })).toBeInTheDocument();
  });

  it('drags a card to another column with the pointer', () => {
    const { actions } = renderBoard();
    layOutBoard();
    pointer(card('row-heater'), 'pointerdown', 100, 60);
    pointer(window, 'pointermove', 110, 60);
    // Its own place changes nothing.
    expect(document.querySelector('[data-drop-indicator]')).toBeNull();
    pointer(window, 'pointermove', 700, 50);
    expect(column(STATUS.done).querySelector('[data-drop-indicator]')).not.toBeNull();
    expect(card('row-heater')).toHaveClass('opacity-50');
    pointer(window, 'pointerup', 700, 50);
    expect(actions.moveRow).toHaveBeenCalledWith('row-heater', {
      beforeRowId: 'row-boiler',
      fromGroupKey: STATUS.notStarted,
      toGroupKey: STATUS.done,
    });
    // The click that ends a drag doesn't open the card.
    fireEvent.click(opener('row-heater'));
    expect(actions.openRow).not.toHaveBeenCalled();
  });

  it('Escape ends a drag without moving the card', () => {
    const { actions } = renderBoard();
    layOutBoard();
    pointer(card('row-drain'), 'pointerdown', 100, 120);
    pointer(window, 'pointermove', 400, 50);
    expect(column(STATUS.inProgress).querySelector('[data-drop-indicator]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    pointer(window, 'pointerup', 400, 50);
    expect(actions.moveRow).not.toHaveBeenCalled();
    expect(document.querySelector('[data-drop-indicator]')).toBeNull();
  });

  it('scrolls the board sideways while a card is held near its edge', async () => {
    renderBoard();
    layOutBoard();
    const board = column(STATUS.done).closest<HTMLElement>('.overflow-x-auto');
    if (!board) throw new Error('No board');
    let left = 0;
    Object.defineProperties(board, {
      scrollWidth: { configurable: true, value: 1200 },
      clientWidth: { configurable: true, value: 600 },
      scrollLeft: {
        configurable: true,
        get: () => left,
        set: (value: number) => {
          left = Math.max(value, 0);
        },
      },
    });
    board.getBoundingClientRect = () => rect(0, 0, 600, 600);
    pointer(card('row-heater'), 'pointerdown', 100, 60);
    pointer(window, 'pointermove', 595, 300);
    await waitFor(() => expect(left).toBeGreaterThan(0));
    pointer(window, 'pointerup', 595, 300);
    const stopped = left;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(left).toBe(stopped);
  });
});

describe('BoardLayout on phones', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === PHONE,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows one column at a time, and picks one from the buttons above', () => {
    renderBoard();
    for (const el of screen.getAllByTestId('board-column')) {
      expect(el).toHaveClass('w-full', 'snap-start');
    }
    const picker = screen.getByRole('group', { name: 'Columns' });
    const buttons = within(picker).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAttribute('aria-current', 'true');
    const scrolled = vi.fn();
    column(STATUS.done).scrollIntoView = scrolled;
    fireEvent.click(within(picker).getByRole('button', { name: /^Done/ }));
    expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ inline: 'start' }));
    expect(within(picker).getByRole('button', { name: /^Done/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(buttons[0]).not.toHaveAttribute('aria-current');
  });

  it('follows a swipe, and lets the board scroll freely while a card is dragged', () => {
    renderBoard();
    layOutBoard();
    const board = column(STATUS.done).closest<HTMLElement>('.overflow-x-auto');
    if (!board) throw new Error('No board');
    expect(board).toHaveClass('snap-x', 'snap-mandatory');
    // The board scrolled so that Done (drawn from x 600) is at its left edge.
    board.getBoundingClientRect = () => rect(600, 0, 300, 600);
    fireEvent.scroll(board);
    const picker = screen.getByRole('group', { name: 'Columns' });
    expect(within(picker).getByRole('button', { name: /^Done/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    pointer(card('row-boiler'), 'pointerdown', 700, 60);
    pointer(window, 'pointermove', 720, 60);
    expect(board).not.toHaveClass('snap-mandatory');
    pointer(window, 'pointerup', 720, 60);
    expect(board).toHaveClass('snap-mandatory');
  });
});

describe('BoardLayout with a sort', () => {
  it('keeps the cards sorted: only moves to another column count', () => {
    const view = boardView({ sorts: [{ propertyId: PROPS.cost, direction: 'desc' }] });
    const { actions } = renderBoard({ view });
    layOutBoard();
    // Dragging within its own column changes nothing.
    pointer(card('row-heater'), 'pointerdown', 100, 60);
    pointer(window, 'pointermove', 100, 140);
    expect(document.querySelector('[data-drop-indicator]')).toBeNull();
    pointer(window, 'pointerup', 100, 140);
    expect(actions.moveRow).not.toHaveBeenCalled();
    // Nor do the arrows within it.
    const heater = opener('row-heater');
    fireEvent.keyDown(heater, { key: ' ' });
    fireEvent.keyDown(heater, { key: 'ArrowDown' });
    expect(screen.queryByText(/^Not started, /)).toBeNull();
    fireEvent.keyDown(heater, { key: 'ArrowRight' });
    expect(screen.getByText('In progress, 1 of 2')).toBeInTheDocument();
    fireEvent.keyDown(heater, { key: ' ' });
    expect(actions.moveRow).toHaveBeenCalledWith('row-heater', {
      beforeRowId: 'row-sink',
      fromGroupKey: STATUS.notStarted,
      toGroupKey: STATUS.inProgress,
    });
  });
});

describe('BoardLayout lanes', () => {
  const lanes: QueryLane[] = [
    {
      key: PRIORITY.high,
      label: 'High',
      color: 'red',
      hidden: false,
      collapsedKey: PRIORITY.high,
      count: 2,
    },
    {
      key: PRIORITY.low,
      label: 'Low',
      color: 'gray',
      hidden: false,
      collapsedKey: PRIORITY.low,
      count: 1,
    },
  ];
  function laneData(): ViewData {
    const data = groupedByStatus();
    const groups = (data.groups ?? []).map((g) => ({
      ...g,
      rows: [],
      subGroups: lanes.map((lane) => {
        const rows = g.rows.filter((r) => r.values[PROPS.priority] === lane.key);
        return {
          ...g,
          key: lane.key,
          label: lane.label,
          color: lane.color,
          count: rows.length,
          rows,
        };
      }),
    }));
    return viewData({ ...data, groups, lanes });
  }
  const laneView = () => boardView({ subGrouping: { propertyId: PROPS.priority } });

  it('splits the columns into lanes that collapse one by one', () => {
    renderBoard({ view: laneView(), data: laneData() });
    expect(cardsIn(column(STATUS.notStarted, PRIORITY.high))).toEqual(['row-heater']);
    expect(cardsIn(column(STATUS.done, PRIORITY.low))).toEqual(['row-boiler']);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse High' }));
    expect(document.querySelector(`[data-lane-key="${PRIORITY.high}"]`)).toBeNull();
    expect(cardsIn(column(STATUS.done, PRIORITY.low))).toEqual(['row-boiler']);
    expect(screen.getByRole('button', { name: 'Expand High' })).toBeInTheDocument();
  });

  it("makes new cards with the lane's value, and loads more per lane", () => {
    const data = laneData();
    const groups = (data.groups ?? []).map((g) => ({
      ...g,
      subGroups: (g.subGroups ?? []).map((s) =>
        g.key === STATUS.done && s.key === PRIORITY.low ? { ...s, nextCursor: 'next' } : s,
      ),
    }));
    const { actions } = renderBoard({ view: laneView(), data: { ...data, groups } });
    const doneLow = column(STATUS.done, PRIORITY.low);
    fireEvent.click(within(doneLow).getByRole('button', { name: 'New' }));
    expect(actions.createRow).toHaveBeenCalledWith({
      groupKey: STATUS.done,
      values: { [PROPS.priority]: PRIORITY.low },
    });
    fireEvent.click(within(doneLow).getByRole('button', { name: 'Load more' }));
    expect(actions.loadMore).toHaveBeenCalledWith(STATUS.done, PRIORITY.low);
  });

  it('moves a card into the lane below by keyboard', () => {
    const { actions } = renderBoard({ view: laneView(), data: laneData() });
    const heater = opener('row-heater');
    fireEvent.keyDown(heater, { key: ' ' });
    fireEvent.keyDown(heater, { key: 'ArrowDown' });
    expect(screen.getByText('Not started, Low, 1 of 1')).toBeInTheDocument();
    fireEvent.keyDown(heater, { key: ' ' });
    expect(actions.moveRow).toHaveBeenCalledWith('row-heater', {
      beforeRowId: null,
      fromGroupKey: STATUS.notStarted,
      toGroupKey: STATUS.notStarted,
      fromSubGroupKey: PRIORITY.high,
      toSubGroupKey: PRIORITY.low,
    });
    expect(
      screen.getByText("Moved 'Replace water heater' to Not started, Low"),
    ).toBeInTheDocument();
  });
});

describe('BoardLayout without a grouping', () => {
  it('shows every row in one column', () => {
    const view = boardView({ grouping: null });
    const rows = [fixtureRow('row-one', 'Call back Blue Pine Plumbing', 7)];
    renderBoard({ view, data: viewData(queryData(rows)) });
    expect(screen.getAllByTestId('board-column')).toHaveLength(1);
    expect(cardsIn(column(''))).toEqual(['row-one']);
  });
});
