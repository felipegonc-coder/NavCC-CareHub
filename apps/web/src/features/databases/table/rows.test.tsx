import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@carehub/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { View } from '@carehub/databases';
import { groupedByStatus, jobsDatabase, layoutProps, PROPS, STATUS, viewData } from '../test-utils';
import TableLayout from './layout';

const rowOf = (rowId: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[role="row"][data-row-id="${rowId}"]`);
  if (!row) throw new Error(`No row ${rowId}`);
  return row;
};
const cellOf = (rowId: string, propertyId: string): HTMLElement => {
  const cell = rowOf(rowId).querySelector<HTMLElement>(`[data-property-id="${propertyId}"]`);
  if (!cell) throw new Error(`No cell ${propertyId} in ${rowId}`);
  return cell;
};
const gutterOf = (rowId: string): HTMLElement => {
  const cell = rowOf(rowId).querySelector<HTMLElement>('[data-select-cell]');
  if (!cell) throw new Error(`No selection cell in ${rowId}`);
  return cell;
};
const handleOf = (rowId: string, title: string) =>
  within(rowOf(rowId)).getByRole('button', { name: `Row menu for ${title}` });
const items = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

function tableView(patch: Partial<View> = {}): View {
  const view = jobsDatabase().views[0];
  if (!view) throw new Error('The fixture needs a table view.');
  return { ...view, ...patch };
}
const byCost: View['sorts'] = [{ propertyId: PROPS.cost, direction: 'asc' }];

/** jsdom draws nothing: rows go 40 px apart in page order, and each group around its rows. */
function layOutRows() {
  const rect = (top: number, height: number) =>
    ({
      x: 0,
      y: top,
      top,
      left: 0,
      right: 800,
      bottom: top + height,
      width: 800,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const rows = [...document.querySelectorAll('[role="row"][data-row-id]')];
    const at = rows.indexOf(this);
    if (at >= 0) return rect(at * 40, 40);
    if (this.getAttribute('role') === 'rowgroup') {
      const inside = rows.flatMap((row, i) => (this.contains(row) ? [i] : []));
      const first = Math.min(...inside);
      return inside.length > 0
        ? rect(first * 40, (Math.max(...inside) - first + 1) * 40)
        : rect(0, 0);
    }
    return rect(0, rows.length * 40);
  });
}

function pointer(target: Element | Window, type: string, clientY: number) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 }));
}

/** Presses the handle at y 100, moves to `toY` and lets go. */
function dragTo(handle: HTMLElement, toY: number) {
  pointer(handle, 'pointerdown', 100);
  pointer(window, 'pointermove', 100 + (toY > 100 ? 10 : -10));
  pointer(window, 'pointermove', toY);
  pointer(window, 'pointerup', toY);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('TableLayout row menu', () => {
  it('opens from the handle without ticking the row: Open, Duplicate, Copy link, Move up and down, Delete', async () => {
    const props = layoutProps();
    const { actions } = props;
    render(<TableLayout {...props} />);
    fireEvent.click(handleOf('row-heater', 'Replace water heater'));
    expect(items()).toEqual(['Open', 'Duplicate', 'Copy link', 'Move up', 'Move down', 'Delete']);
    expect(rowOf('row-heater')).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(actions.moveRow).toHaveBeenCalledWith('row-heater', { beforeRowId: 'row-sink' });
    expect(rowOf('row-heater')).toHaveAttribute('aria-selected', 'false');
    await waitFor(() => expect(gutterOf('row-heater')).toHaveFocus());

    fireEvent.click(handleOf('row-heater', 'Replace water heater'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(actions.moveRow).toHaveBeenLastCalledWith('row-heater', { beforeRowId: 'row-drain' });

    fireEvent.click(handleOf('row-sink', 'Fix kitchen sink leak'));
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(actions.openRow).toHaveBeenCalledWith('row-sink');
  });

  it('deletes the row and moves focus to the next one', async () => {
    const props = layoutProps();
    const { actions } = props;
    render(<TableLayout {...props} />);
    fireEvent.click(handleOf('row-boiler', 'Annual boiler service'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(actions.trashRows).toHaveBeenCalledWith(['row-boiler']);
    await waitFor(() => expect(gutterOf('row-drain')).toHaveFocus());
  });

  it('duplicates the row and gives focus back to the row', async () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(handleOf('row-heater', 'Replace water heater'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(props.actions.duplicateRows).toHaveBeenCalledWith(['row-heater']);
    await waitFor(() => expect(gutterOf('row-heater')).toHaveFocus());
  });

  it('copies a link to the row', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const props = layoutProps();
    render(
      <ToastProvider>
        <TableLayout {...props} />
      </ToastProvider>,
    );
    fireEvent.click(handleOf('row-drain', 'Unclog bathroom drain'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/row-drain`);
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('opens with Shift+F10 on a cell and gives focus back to it', async () => {
    const props = layoutProps();
    const { actions } = props;
    render(<TableLayout {...props} />);
    const cost = cellOf('row-boiler', PROPS.cost);
    cost.focus();
    fireEvent.keyDown(cost, { key: 'F10', shiftKey: true });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(cellOf('row-boiler', PROPS.cost)).toHaveFocus());

    fireEvent.keyDown(cellOf('row-boiler', PROPS.cost), { key: 'ContextMenu' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(actions.moveRow).toHaveBeenCalledWith('row-boiler', { beforeRowId: 'row-heater' });
    await waitFor(() => expect(cellOf('row-boiler', PROPS.cost)).toHaveFocus());
  });

  it('has no moves in a sorted view, and no handles when read-only', () => {
    const sorted = layoutProps({ view: tableView({ sorts: byCost }) });
    const { unmount } = render(<TableLayout {...sorted} />);
    fireEvent.click(handleOf('row-drain', 'Unclog bathroom drain'));
    expect(items()).toEqual(['Open', 'Duplicate', 'Copy link', 'Delete']);
    unmount();

    render(<TableLayout {...layoutProps({ readOnly: true })} />);
    expect(screen.queryByRole('button', { name: /^Row menu for/ })).toBeNull();
    fireEvent.keyDown(cellOf('row-boiler', PROPS.cost), { key: 'F10', shiftKey: true });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('TableLayout row drag', () => {
  it('drags a row to another place in manual order', () => {
    const props = layoutProps();
    const { actions } = props;
    render(<TableLayout {...props} />);
    layOutRows();
    // Rows: sink 0-40, heater 40-80, boiler 80-120, drain 120-160.
    dragTo(handleOf('row-drain', 'Unclog bathroom drain'), 42);
    expect(actions.moveRow).toHaveBeenCalledWith('row-drain', { beforeRowId: 'row-heater' });
    dragTo(handleOf('row-sink', 'Fix kitchen sink leak'), 158);
    expect(actions.moveRow).toHaveBeenLastCalledWith('row-sink', { beforeRowId: null });
    // Its own place changes nothing, and the drag doesn't open the menu.
    dragTo(handleOf('row-heater', 'Replace water heater'), 78);
    expect(actions.moveRow).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows where the row lands, and Escape cancels', () => {
    const props = layoutProps();
    const { actions } = props;
    const { container } = render(<TableLayout {...props} />);
    layOutRows();
    const handle = handleOf('row-drain', 'Unclog bathroom drain');
    pointer(handle, 'pointerdown', 140);
    pointer(window, 'pointermove', 41);
    expect(container.querySelector('[data-row-drop]')).toHaveStyle({ top: '40px' });
    expect(rowOf('row-drain')).toHaveClass('opacity-50');
    fireEvent.keyDown(window, { key: 'Escape' });
    pointer(window, 'pointerup', 41);
    expect(actions.moveRow).not.toHaveBeenCalled();
    expect(container.querySelector('[data-row-drop]')).toBeNull();
  });

  it('moves a row into another group; sorted, only the group changes', () => {
    const grouped = tableView({ grouping: { propertyId: PROPS.status } });
    const first = layoutProps({ view: grouped, data: viewData(groupedByStatus()) });
    const { unmount } = render(<TableLayout {...first} />);
    layOutRows();
    // Not started: heater 0-40, drain 40-80; In progress: sink 80-120; Done: boiler 120-160.
    dragTo(handleOf('row-sink', 'Fix kitchen sink leak'), 122);
    expect(first.actions.moveRow).toHaveBeenCalledWith('row-sink', {
      beforeRowId: 'row-boiler',
      fromGroupKey: STATUS.inProgress,
      toGroupKey: STATUS.done,
    });
    unmount();
    vi.restoreAllMocks();

    const sorted = layoutProps({
      view: { ...grouped, sorts: byCost },
      data: viewData(groupedByStatus()),
    });
    render(<TableLayout {...sorted} />);
    layOutRows();
    dragTo(handleOf('row-sink', 'Fix kitchen sink leak'), 130);
    expect(sorted.actions.moveRow).toHaveBeenCalledWith('row-sink', {
      beforeRowId: null,
      fromGroupKey: STATUS.inProgress,
      toGroupKey: STATUS.done,
    });
    dragTo(handleOf('row-heater', 'Replace water heater'), 60);
    expect(sorted.actions.moveRow).toHaveBeenCalledTimes(1);
  });

  it("doesn't drag in a sorted view without groups", () => {
    const props = layoutProps({ view: tableView({ sorts: byCost }) });
    render(<TableLayout {...props} />);
    layOutRows();
    dragTo(handleOf('row-drain', 'Unclog bathroom drain'), 0);
    expect(props.actions.moveRow).not.toHaveBeenCalled();
  });
});
