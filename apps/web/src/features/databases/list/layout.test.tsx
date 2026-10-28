import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@carehub/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultView, type View } from '@carehub/databases';
import type { LayoutProps, QueryGroup, QueryRow, ViewData } from '../contract';
import {
  groupedByStatus,
  jobsProperties,
  jobsRows,
  layoutProps,
  PROPS,
  queryData,
  STATUS,
  viewData,
} from '../test-utils';
import ListLayout from './layout';

function listView(patch: Partial<View> = {}): View {
  return {
    ...defaultView('list', jobsProperties(), { name: 'Job list' }),
    id: 'view-list',
    ...patch,
  };
}

const byStatus = { propertyId: PROPS.status };

function renderList(overrides: Partial<Omit<LayoutProps, 'actions'>> = {}) {
  const props = layoutProps({ view: listView(), ...overrides });
  const list = (next: LayoutProps) => (
    <ToastProvider>
      <ListLayout {...next} />
    </ToastProvider>
  );
  const result = render(list(props));
  return {
    ...result,
    props,
    actions: props.actions,
    redraw: (patch: Partial<LayoutProps>) => result.rerender(list({ ...props, ...patch })),
  };
}

const line = (rowId: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`li[data-row-id="${rowId}"]`);
  if (!found) throw new Error(`No line ${rowId}`);
  return found;
};
const opener = (rowId: string): HTMLElement => {
  const found = line(rowId).querySelector<HTMLElement>('[data-card-open]');
  if (!found) throw new Error(`No title on ${rowId}`);
  return found;
};
const lineIds = (el: ParentNode = document) =>
  [...el.querySelectorAll('li[data-row-id]')].map((li) => li.getAttribute('data-row-id'));
const group = (key: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('[data-testid="list-group"]')].find(
    (el) => el.dataset.groupKey === key,
  );
  if (!found) throw new Error(`No group ${key}`);
  return found;
};

/** jsdom draws nothing: lines stand 40 px apart from y 0. */
function layOutLines() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = (top: number, height: number) =>
      ({
        x: 0,
        y: top,
        left: 0,
        top,
        right: 600,
        bottom: top + height,
        width: 600,
        height,
        toJSON: () => ({}),
      }) as DOMRect;
    if (this.matches('[data-board-slot]')) return box(0, 400);
    if (this.matches('li[data-row-id]')) {
      const index = [...document.querySelectorAll('li[data-row-id]')].indexOf(this);
      return box(index * 40, 36);
    }
    return box(0, 0);
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

describe('ListLayout lines', () => {
  it('draws a line per row: its icon, its title and the properties the view shows', () => {
    const rows = jobsRows().map((r) => (r.id === 'row-boiler' ? { ...r, icon: '🔥' } : r));
    const view = listView({
      properties: [
        { propertyId: PROPS.name, visible: true },
        { propertyId: PROPS.priority, visible: true },
        { propertyId: PROPS.due, visible: true },
      ],
    });
    renderList({ view, data: viewData(queryData(rows)) });
    expect(lineIds()).toEqual(['row-sink', 'row-heater', 'row-boiler', 'row-drain']);
    expect(screen.getByRole('listitem', { name: 'Fix kitchen sink leak' })).toBe(line('row-sink'));
    expect(within(line('row-boiler')).getByText('🔥')).toBeInTheDocument();
    // Rows without an emoji show the page icon.
    expect(line('row-sink').firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(within(line('row-sink')).getByText('High')).toBeInTheDocument();
    expect(line('row-sink').querySelector(`[data-property-id="${PROPS.due}"]`)).not.toBeNull();
    expect(line('row-drain').querySelector(`[data-property-id="${PROPS.due}"]`)).toBeNull();
    // Properties the view hides stay off the line.
    expect(line('row-sink').querySelector(`[data-property-id="${PROPS.cost}"]`)).toBeNull();
  });

  it('leaves the icons out when the view hides page icons, and the title when it hides it', () => {
    renderList({ view: listView({ showPageIcon: false, showTitle: false }) });
    expect(line('row-sink').firstElementChild).toBe(opener('row-sink'));
    expect(within(line('row-sink')).getByText('Fix kitchen sink leak')).toHaveClass('sr-only');
  });

  it('opens a row on click and with Enter', () => {
    const { actions } = renderList();
    fireEvent.click(opener('row-sink'));
    expect(actions.openRow).toHaveBeenCalledWith('row-sink');
    fireEvent.keyDown(opener('row-boiler'), { key: 'Enter' });
    expect(actions.openRow).toHaveBeenLastCalledWith('row-boiler');
  });

  it('moves focus between lines with the arrow keys', () => {
    renderList();
    opener('row-sink').focus();
    fireEvent.keyDown(opener('row-sink'), { key: 'ArrowDown' });
    expect(opener('row-heater')).toHaveFocus();
    fireEvent.keyDown(opener('row-heater'), { key: 'ArrowUp' });
    expect(opener('row-sink')).toHaveFocus();
  });

  it("shows the view's calculations at the end", () => {
    const data = queryData(jobsRows(), {
      totals: { [PROPS.cost]: { value: { kind: 'number', value: 2050 }, text: 'Sum 2,050' } },
    });
    renderList({ data: viewData(data) });
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('Sum 2,050')).toBeInTheDocument();
  });

  it('"Load more" asks for the next page', () => {
    const data = queryData(jobsRows(), { count: 80, nextCursor: 'cursor-2' });
    const { actions } = renderList({ data: viewData(data) });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(actions.loadMore).toHaveBeenCalledWith();
  });

  it('"+ New" adds a line at the end and edits its title in place', async () => {
    const { actions, redraw } = renderList();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(actions.createRow).toHaveBeenCalledWith({});
    const input = await screen.findByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: 'Call back Blue Pine Plumbing' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.updateValues).toHaveBeenCalledWith('row-new', {
      [PROPS.name]: 'Call back Blue Pine Plumbing',
    });
    expect(lineIds().at(-1)).toBe('row-new');
    expect(screen.getByRole('listitem', { name: 'Call back Blue Pine Plumbing' })).toBeVisible();
    redraw({ data: viewData(queryData()) });
    expect(within(line('row-new')).getByText('Hidden by filter')).toBeInTheDocument();
  });

  it('offers nothing that changes rows when read-only', () => {
    renderList({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Row menu for Replace water heater' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Open', 'Copy link']);
  });
});

describe('ListLayout groups', () => {
  const grouped = () => renderList({ view: listView({ grouping: byStatus }) });

  it('draws a section per group with its label and count', () => {
    grouped();
    const keys = screen.getAllByTestId('list-group').map((el) => el.dataset.groupKey);
    expect(keys).toEqual([STATUS.notStarted, STATUS.inProgress, STATUS.done]);
    const heading = within(group(STATUS.notStarted)).getByRole('button', { name: /^Not started/ });
    expect(heading).toHaveAttribute('aria-expanded', 'true');
    expect(within(heading).getByText('2')).toBeInTheDocument();
    expect(within(heading).getByText('Not started')).toHaveClass('text-gray-text');
    expect(lineIds(group(STATUS.notStarted))).toEqual(['row-heater', 'row-drain']);
  });

  it('collapses a group and remembers it for this person', () => {
    const first = grouped();
    fireEvent.click(within(group(STATUS.done)).getByRole('button', { name: /^Done/ }));
    expect(lineIds(group(STATUS.done))).toEqual([]);
    first.unmount();
    grouped();
    expect(within(group(STATUS.done)).getByRole('button', { name: /^Done/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(lineIds(group(STATUS.done))).toEqual([]);
  });

  it("leaves hidden groups out and shows each group's calculations under it", () => {
    const data = groupedByStatus();
    const groups = (data.groups ?? []).map((g): QueryGroup =>
      g.key === STATUS.done
        ? { ...g, hidden: true }
        : g.key === STATUS.notStarted
          ? {
              ...g,
              totals: {
                [PROPS.cost]: { value: { kind: 'number', value: 1650 }, text: 'Sum 1,650' },
              },
            }
          : g,
    );
    renderList({ view: listView({ grouping: byStatus }), data: viewData({ ...data, groups }) });
    const keys = screen.getAllByTestId('list-group').map((el) => el.dataset.groupKey);
    expect(keys).toEqual([STATUS.notStarted, STATUS.inProgress]);
    expect(within(group(STATUS.notStarted)).getByText('Sum 1,650')).toBeInTheDocument();
  });

  it('"Load more" and "+ New" work per group', () => {
    const data = groupedByStatus();
    const groups = (data.groups ?? []).map((g) =>
      g.key === STATUS.done ? { ...g, count: 60, nextCursor: 'cursor-2' } : g,
    );
    const { actions } = renderList({
      view: listView({ grouping: byStatus }),
      data: viewData({ ...data, groups }),
    });
    expect(
      within(group(STATUS.notStarted)).queryByRole('button', { name: 'Load more' }),
    ).toBeNull();
    fireEvent.click(within(group(STATUS.done)).getByRole('button', { name: 'Load more' }));
    expect(actions.loadMore).toHaveBeenCalledWith(STATUS.done);
    fireEvent.click(within(group(STATUS.inProgress)).getByRole('button', { name: 'New' }));
    expect(actions.createRow).toHaveBeenCalledWith({ groupKey: STATUS.inProgress });
  });

  it('moves a line to another group with "Move to…"', () => {
    const { actions } = grouped();
    fireEvent.click(screen.getByRole('button', { name: 'Row menu for Replace water heater' }));
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

  it('moves a line by keyboard into the next group', () => {
    const { actions } = grouped();
    const drain = opener('row-drain');
    fireEvent.keyDown(drain, { key: ' ' });
    expect(screen.getByText(/^Picked up 'Unclog bathroom drain'/)).toBeInTheDocument();
    fireEvent.keyDown(drain, { key: 'ArrowDown' });
    expect(screen.getByText('In progress, 1 of 2')).toBeInTheDocument();
    fireEvent.keyDown(drain, { key: ' ' });
    expect(actions.moveRow).toHaveBeenCalledWith('row-drain', {
      beforeRowId: 'row-sink',
      fromGroupKey: STATUS.notStarted,
      toGroupKey: STATUS.inProgress,
    });
  });
});

describe('ListLayout reordering', () => {
  it('moves a line by keyboard: Space picks it up, arrows move it, Space drops it', () => {
    const { actions } = renderList();
    const heater = opener('row-heater');
    fireEvent.keyDown(heater, { key: ' ' });
    expect(line('row-heater')).toHaveClass('ring-2');
    fireEvent.keyDown(heater, { key: 'ArrowDown' });
    expect(screen.getByText('Job list, 3 of 4')).toBeInTheDocument();
    expect(document.querySelector('[data-drop-indicator]')).not.toBeNull();
    fireEvent.keyDown(heater, { key: ' ' });
    expect(actions.moveRow).toHaveBeenCalledWith('row-heater', { beforeRowId: 'row-drain' });
  });

  it('drags a line to a new place with the pointer', () => {
    const { actions } = renderList();
    layOutLines();
    pointer(line('row-sink'), 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 50, 20);
    // Its own place changes nothing.
    expect(document.querySelector('[data-drop-indicator]')).toBeNull();
    pointer(window, 'pointermove', 50, 125);
    expect(line('row-sink')).toHaveClass('opacity-50');
    expect(document.querySelector('[data-drop-indicator]')).not.toBeNull();
    pointer(window, 'pointerup', 50, 125);
    expect(actions.moveRow).toHaveBeenCalledWith('row-sink', { beforeRowId: 'row-drain' });
    // The click that ends a drag doesn't open the row.
    fireEvent.click(opener('row-sink'));
    expect(actions.openRow).not.toHaveBeenCalled();
  });

  it('keeps a sorted list in its order', () => {
    const view = listView({ sorts: [{ propertyId: PROPS.due, direction: 'asc' }] });
    const { actions } = renderList({ view });
    const heater = opener('row-heater');
    fireEvent.keyDown(heater, { key: ' ' });
    fireEvent.keyDown(heater, { key: 'ArrowDown' });
    fireEvent.keyDown(heater, { key: ' ' });
    expect(actions.moveRow).not.toHaveBeenCalled();
    expect(line('row-heater')).not.toHaveClass('ring-2');
  });
});

describe('ListLayout sub-items', () => {
  /** Unclog bathroom drain is a sub-item of Replace water heater; the sink job is context. */
  function nested(): ViewData {
    const data = viewData(queryData(jobsRows()));
    const place: Record<string, Partial<QueryRow>> = {
      'row-sink': { depth: 0, parentId: null, childCount: 0, context: true },
      'row-heater': { depth: 0, parentId: null, childCount: 1, context: false },
      'row-drain': { depth: 1, parentId: 'row-heater', childCount: 0, context: false },
      'row-boiler': { depth: 0, parentId: null, childCount: 0, context: false },
    };
    const rows = ['row-sink', 'row-heater', 'row-drain', 'row-boiler'].flatMap((id) => {
      const row = data.rows.find((r) => r.id === id);
      return row ? [{ ...row, ...place[id] }] : [];
    });
    return { ...data, rows };
  }

  it('stands sub-items in under their parent, whose arrow hides and shows them', () => {
    renderList({ data: nested() });
    expect(lineIds()).toEqual(['row-sink', 'row-heater', 'row-drain', 'row-boiler']);
    expect(line('row-drain').style.marginLeft).toMatch(/^24px$/);
    expect(line('row-drain')).toHaveAttribute('aria-level', '2');
    // Shown only because a sub-item matches: greyed.
    expect(line('row-sink')).toHaveClass('text-muted');
    const arrow = within(line('row-heater')).getByRole('button', {
      name: 'Collapse Replace water heater',
    });
    expect(arrow).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(arrow);
    expect(lineIds()).toEqual(['row-sink', 'row-heater', 'row-boiler']);
    fireEvent.keyDown(opener('row-heater'), { key: 'ArrowRight' });
    expect(lineIds()).toEqual(['row-sink', 'row-heater', 'row-drain', 'row-boiler']);
    fireEvent.keyDown(opener('row-heater'), { key: 'ArrowLeft' });
    expect(lineIds()).toEqual(['row-sink', 'row-heater', 'row-boiler']);
    expect(
      within(line('row-heater')).getByRole('button', { name: 'Expand Replace water heater' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('ListLayout while the answer changes', () => {
  it('keeps drawing from the latest answer', () => {
    const { redraw, props } = renderList();
    const fewer: ViewData = { ...props.data, rows: props.data.rows.slice(0, 2), count: 2 };
    redraw({ data: fewer });
    expect(lineIds()).toEqual(['row-sink', 'row-heater']);
  });
});
