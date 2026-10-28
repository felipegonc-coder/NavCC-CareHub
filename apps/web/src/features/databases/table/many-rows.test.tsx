import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { View } from '@carehub/databases';
import { fixtureRow, jobsDatabase, layoutProps, PROPS, queryData, viewData } from '../test-utils';
import TableLayout from './layout';

const manyRows = (count: number) =>
  Array.from({ length: count }, (_, i) => fixtureRow(`row-${i}`, `Job ${i + 1}`, i + 1));
const manyProps = (count: number, readOnly = false) =>
  layoutProps({ data: viewData(queryData(manyRows(count))), readOnly });
const drawnIds = () =>
  [...document.querySelectorAll('[role="row"][data-row-id]')].map((row) =>
    row.getAttribute('data-row-id'),
  );
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

/** jsdom draws nothing: the rows' top edge goes `y` px from the screen's top, the rest at 0. */
function rowsTopAt(y: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = this.hasAttribute('data-rows-top') ? y : 0;
    return { x: 0, y: top, top, left: 0, right: 0, bottom: top, width: 0, height: 0 } as DOMRect;
  });
}

/** A pointer event from a finger (jsdom has no PointerEvent, so a MouseEvent stands in). */
function touch(target: Element, type: string) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 20, clientY: 20 });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  fireEvent(target, event);
}
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TableLayout virtual rows', () => {
  it('draws all of 1,000 rows', () => {
    // Only Name, and nothing to tick, so a thousand rows draw quickly.
    const meta = jobsDatabase();
    const table = meta.views[0];
    if (!table) throw new Error('The fixture needs a table view.');
    const view: View = {
      ...table,
      properties: meta.properties.map((p) => ({ propertyId: p.id, visible: p.id === PROPS.name })),
    };
    render(<TableLayout {...manyProps(1000, true)} view={view} />);
    expect(drawnIds()).toHaveLength(1000);
    expect(screen.getByRole('grid')).not.toHaveAttribute('aria-rowcount');
  }, 20000);

  it('past 1,000 draws only the rows near the screen, numbered for screen readers', () => {
    render(<TableLayout {...manyProps(1500)} />);
    const drawn = drawnIds();
    expect(drawn[0]).toBe('row-0');
    expect(drawn.length).toBeGreaterThan(10);
    expect(drawn.length).toBeLessThan(100);
    // The header row, 1,500 rows, New and the totals row.
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '1503');
    expect(rowOf('row-0')).toHaveAttribute('aria-rowindex', '2');
    expect(screen.getByTestId('db-totals')).toHaveAttribute('aria-rowindex', '1503');
  });

  it('draws the rows that scroll onto the screen', async () => {
    render(<TableLayout {...manyProps(1500)} />);
    // 700 rows (37 px each until measured) above the screen.
    rowsTopAt(-37 * 700);
    fireEvent.scroll(window);
    await waitFor(() => expect(drawnIds()).toContain('row-700'));
    expect(drawnIds()).not.toContain('row-100');
    expect(rowOf('row-700')).toHaveAttribute('aria-rowindex', '702');
  });

  it('moves the focus to rows that are not drawn', async () => {
    render(<TableLayout {...manyProps(1500)} />);
    expect(drawnIds()).not.toContain('row-1499');
    fireEvent.keyDown(cellOf('row-0', PROPS.status), { key: 'End', ctrlKey: true });
    await waitFor(() => expect(cellOf('row-1499', PROPS.notes)).toHaveFocus());
    fireEvent.keyDown(cellOf('row-1499', PROPS.notes), { key: 'ArrowUp' });
    await waitFor(() => expect(cellOf('row-1498', PROPS.notes)).toHaveFocus());
  });

  it('ticks every row with Ctrl+A, drawn or not', () => {
    render(<TableLayout {...manyProps(1500)} />);
    fireEvent.keyDown(cellOf('row-0', PROPS.status), { key: 'a', ctrlKey: true });
    expect(screen.getByRole('toolbar', { name: 'Selected rows' })).toHaveTextContent(
      '1500 selected',
    );
  });
});

describe('TableLayout long press', () => {
  it('opens the row menu, and the lift is not a tap on the cell', async () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    const name = cellOf('row-heater', PROPS.name);
    touch(name, 'pointerdown');
    await wait(300);
    expect(screen.queryByRole('menu')).toBeNull();
    await wait(300);
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    touch(name, 'pointerup');
    fireEvent.click(name);
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(props.actions.openRow).toHaveBeenCalledWith('row-heater');
  });

  it('opens nothing when the finger moves (a scroll)', async () => {
    render(<TableLayout {...layoutProps()} />);
    const name = cellOf('row-heater', PROPS.name);
    touch(name, 'pointerdown');
    const move = new MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 60 });
    Object.defineProperty(move, 'pointerType', { value: 'touch' });
    fireEvent(name, move);
    await wait(600);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens nothing for people who can only read', async () => {
    render(<TableLayout {...layoutProps({ readOnly: true })} />);
    touch(cellOf('row-heater', PROPS.name), 'pointerdown');
    await wait(600);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
