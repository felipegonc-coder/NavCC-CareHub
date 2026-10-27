import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { colorClasses } from '@carehub/ui';
import type { View } from '@carehub/databases';
import {
  fixtureRow,
  groupedByStatus,
  jobsDatabase,
  jobsRows,
  layoutProps,
  PROPS,
  queryData,
  STATUS,
  viewData,
} from '../test-utils';
import TableLayout from './layout';

function tableView(patch: Partial<View> = {}): View {
  const view = jobsDatabase().views[0];
  if (!view) throw new Error('The fixture needs a table view.');
  return { ...view, ...patch };
}

const byStatus = () => tableView({ grouping: { propertyId: PROPS.status } });

function bodyRows(scope: HTMLElement = document.body): HTMLElement[] {
  return within(scope)
    .getAllByRole('row')
    .filter((row) => row.hasAttribute('data-row-id'));
}

function rowOf(rowId: string, scope?: HTMLElement): HTMLElement {
  const row = bodyRows(scope).find((r) => r.getAttribute('data-row-id') === rowId);
  if (!row) throw new Error(`No row ${rowId}`);
  return row;
}

function cellOf(rowId: string, propertyId: string): HTMLElement {
  const cell = rowOf(rowId).querySelector<HTMLElement>(`[data-property-id="${propertyId}"]`);
  if (!cell) throw new Error(`No cell ${propertyId} in ${rowId}`);
  return cell;
}

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

describe('TableLayout columns', () => {
  it('shows a column for each visible property, Name first', () => {
    render(<TableLayout {...layoutProps()} />);
    expect(screen.getByRole('grid', { name: 'All jobs' })).toBeInTheDocument();
    expect(headers()).toEqual([
      'Name',
      'Status',
      'Priority',
      'Due date',
      'Technician',
      'Cost',
      'Paid',
      'Notes',
    ]);
  });

  it('follows the view order and widths and leaves out hidden properties', () => {
    const view = tableView({
      properties: [
        { propertyId: PROPS.cost, visible: true, width: 120 },
        { propertyId: PROPS.name, visible: true },
        { propertyId: PROPS.status, visible: false },
        { propertyId: PROPS.notes, visible: true, width: 2000 },
      ],
    });
    render(<TableLayout {...layoutProps({ view })} />);
    expect(headers()).toEqual(['Name', 'Cost', 'Notes']);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveStyle({ width: '280px' });
    expect(screen.getByRole('columnheader', { name: 'Cost' })).toHaveStyle({ width: '120px' });
    expect(screen.getByRole('columnheader', { name: 'Notes' })).toHaveStyle({ width: '800px' });
  });

  it("leaves out properties the viewer can't see", () => {
    const data = viewData(queryData(jobsRows(), { propertyIds: [PROPS.name, PROPS.status] }));
    render(<TableLayout {...layoutProps({ data })} />);
    expect(headers()).toEqual(['Name', 'Status']);
  });

  it('keeps frozen columns in place', () => {
    const view = tableView({
      table: { frozenUpTo: PROPS.status, wrapCells: false, showVerticalLines: true },
    });
    render(<TableLayout {...layoutProps({ view })} />);
    expect(screen.getByRole('columnheader', { name: 'Status' })).toHaveStyle({ left: '280px' });
    expect(cellOf('row-sink', PROPS.name)).toHaveClass('sticky');
    expect(cellOf('row-sink', PROPS.status)).toHaveClass('sticky');
    expect(cellOf('row-sink', PROPS.priority)).not.toHaveClass('sticky');
  });
});

describe('TableLayout rows', () => {
  it('shows every row with its cells, and "Untitled" for an empty Name', () => {
    const rows = [...jobsRows(), fixtureRow('row-empty', '', 9)];
    render(<TableLayout {...layoutProps({ data: viewData(queryData(rows)) })} />);
    expect(bodyRows().map((r) => r.getAttribute('data-row-id'))).toEqual([
      'row-sink',
      'row-heater',
      'row-boiler',
      'row-drain',
      'row-empty',
    ]);
    expect(within(rowOf('row-sink')).getByRole('rowheader')).toHaveTextContent(
      'Fix kitchen sink leak',
    );
    expect(within(rowOf('row-empty')).getByRole('rowheader')).toHaveTextContent('Untitled');
    expect(cellOf('row-sink', PROPS.status)).toHaveTextContent('In progress');
    expect(cellOf('row-sink', PROPS.status)).toHaveAttribute('role', 'gridcell');
  });

  it('groups rows under headers with the label, colour and count', () => {
    render(<TableLayout {...layoutProps({ view: byStatus() })} />);
    const names = screen
      .getAllByRole('rowgroup')
      .map((g) => g.getAttribute('aria-label'))
      .filter(Boolean);
    expect(names).toEqual(['Not started', 'In progress', 'Done']);
    const notStarted = screen.getByRole('rowgroup', { name: 'Not started' });
    expect(bodyRows(notStarted).map((r) => r.getAttribute('data-row-id'))).toEqual([
      'row-heater',
      'row-drain',
    ]);
    const toggle = within(notStarted).getByRole('button', { name: /Not started/ });
    expect(within(toggle).getByText('2')).toBeInTheDocument();
    const inProgress = screen.getByRole('rowgroup', { name: 'In progress' });
    const inProgressToggle = within(inProgress).getByRole('button', { name: /In progress/ });
    const label = within(inProgressToggle).getByText('In progress');
    expect(label).toHaveClass(colorClasses.blue.bg, colorClasses.blue.text);
  });

  it('collapses and expands a group', () => {
    render(<TableLayout {...layoutProps({ view: byStatus() })} />);
    const group = screen.getByRole('rowgroup', { name: 'In progress' });
    const toggle = within(group).getByRole('button', { name: /In progress/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(group.querySelector('[data-row-id="row-sink"]')).toBeNull();
    expect(within(group).queryByRole('button', { name: 'New' })).toBeNull();
    fireEvent.click(toggle);
    expect(rowOf('row-sink', group)).toBeInTheDocument();
  });

  it('opens a row from its Open button', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(within(rowOf('row-heater')).getByRole('button', { name: 'Open' }));
    expect(props.actions.openRow).toHaveBeenCalledWith('row-heater');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('loads more rows of the view', () => {
    const props = layoutProps({ data: viewData(queryData(jobsRows(), { nextCursor: 'next' })) });
    render(<TableLayout {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(props.actions.loadMore).toHaveBeenCalledTimes(1);
    expect(props.actions.loadMore.mock.calls[0]).toEqual([]);
  });

  it('shows "Load more" as busy while it loads', () => {
    const data = { ...viewData(queryData(jobsRows(), { nextCursor: 'next' })), loadingMore: [''] };
    render(<TableLayout {...layoutProps({ data })} />);
    expect(screen.getByRole('button', { name: 'Load more' })).toHaveAttribute('aria-busy', 'true');
  });

  it('loads more rows of one group', () => {
    const grouped = groupedByStatus();
    const groups =
      grouped.groups?.map((g) => (g.key === STATUS.done ? { ...g, nextCursor: 'more' } : g)) ??
      null;
    const props = layoutProps({ view: byStatus(), data: viewData({ ...grouped, groups }) });
    render(<TableLayout {...props} />);
    const done = screen.getByRole('rowgroup', { name: 'Done' });
    fireEvent.click(within(done).getByRole('button', { name: 'Load more' }));
    expect(props.actions.loadMore).toHaveBeenCalledWith(STATUS.done);
    expect(screen.getAllByRole('button', { name: 'Load more' })).toHaveLength(1);
  });
});

describe('TableLayout totals', () => {
  it("shows the view's column totals in the footer", () => {
    const totals = {
      [PROPS.cost]: { value: { kind: 'number' as const, value: 1850 }, text: 'Sum $1,850.00' },
    };
    render(<TableLayout {...layoutProps({ data: viewData(queryData(jobsRows(), { totals })) })} />);
    const footer = screen.getByTestId('db-totals');
    const cell = within(footer).getByText('Sum $1,850.00').closest('[data-property-id]');
    expect(cell).toHaveAttribute('data-property-id', PROPS.cost);
  });

  it("shows each group's totals under the group", () => {
    const grouped = groupedByStatus();
    const total = { value: { kind: 'number' as const, value: 2 }, text: 'Count all 2' };
    const groups =
      grouped.groups?.map((g) =>
        g.key === STATUS.notStarted ? { ...g, totals: { [PROPS.name]: total } } : g,
      ) ?? null;
    render(
      <TableLayout
        {...layoutProps({ view: byStatus(), data: viewData({ ...grouped, groups }) })}
      />,
    );
    const group = screen.getByRole('rowgroup', { name: 'Not started' });
    expect(within(group).getByText('Count all 2')).toBeInTheDocument();
  });
});

describe('TableLayout editing', () => {
  it('edits a cell on click and saves with Enter', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(cellOf('row-drain', PROPS.name));
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveValue('Unclog bathroom drain');
    fireEvent.change(input, { target: { value: 'Clear the shower drain' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.actions.updateValues).toHaveBeenCalledWith('row-drain', {
      [PROPS.name]: 'Clear the shower drain',
    });
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(cellOf('row-drain', PROPS.name)).toHaveFocus();
  });

  it('leaves without saving on Escape', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(cellOf('row-sink', PROPS.notes));
    const input = screen.getByRole('textbox', { name: 'Notes' });
    fireEvent.change(input, { target: { value: 'Call before going' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.actions.updateValues).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(cellOf('row-sink', PROPS.notes)).toHaveFocus();
  });

  it("doesn't save an unchanged value, and Tab moves to the next cell", () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(cellOf('row-sink', PROPS.name));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Tab' });
    expect(props.actions.updateValues).not.toHaveBeenCalled();
    expect(cellOf('row-sink', PROPS.status)).toHaveFocus();
  });

  it('ticks a checkbox straight from the cell', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(within(rowOf('row-sink')).getByRole('checkbox', { name: 'Paid' }));
    expect(props.actions.updateValues).toHaveBeenCalledWith('row-sink', { [PROPS.paid]: true });
  });

  it('adds a row with New and starts on its Name', async () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(props.actions.createRow).toHaveBeenCalledWith({});
    const input = await screen.findByRole('textbox', { name: 'Name' });
    expect(rowOf('row-new')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Fix the outdoor tap' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.actions.updateValues).toHaveBeenCalledWith('row-new', {
      [PROPS.name]: 'Fix the outdoor tap',
    });
    expect(within(rowOf('row-new')).getByRole('rowheader')).toHaveTextContent(
      'Fix the outdoor tap',
    );
  });

  it('adds a row inside a group', async () => {
    const props = layoutProps({ view: byStatus() });
    render(<TableLayout {...props} />);
    const group = screen.getByRole('rowgroup', { name: 'In progress' });
    fireEvent.click(within(group).getByRole('button', { name: 'New' }));
    expect(props.actions.createRow).toHaveBeenCalledWith({ groupKey: STATUS.inProgress });
    await screen.findByRole('textbox', { name: 'Name' });
    expect(rowOf('row-new', group)).toBeInTheDocument();
  });

  it('says "Hidden by filter" when the newer answer leaves a new row out', async () => {
    const props = layoutProps();
    const { rerender } = render(<TableLayout {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const input = await screen.findByRole('textbox', { name: 'Name' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('Hidden by filter')).toBeNull();
    rerender(<TableLayout {...props} data={viewData(queryData())} />);
    expect(within(rowOf('row-new')).getByText('Hidden by filter')).toBeInTheDocument();
  });

  it('turns editing off when read-only', () => {
    const props = layoutProps({ readOnly: true });
    render(<TableLayout {...props} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    const cell = cellOf('row-sink', PROPS.notes);
    fireEvent.click(cell);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(cell).toHaveFocus();
    fireEvent.keyDown(cell, { key: 'Delete' });
    fireEvent.keyDown(cell, { key: 'x' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(props.actions.updateValues).not.toHaveBeenCalled();
  });
});

describe('TableLayout keyboard', () => {
  it('moves between cells with the arrows, Home, End and Tab', () => {
    render(<TableLayout {...layoutProps({ readOnly: true })} />);
    const start = cellOf('row-sink', PROPS.status);
    fireEvent.click(start);
    fireEvent.keyDown(start, { key: 'ArrowDown' });
    expect(cellOf('row-heater', PROPS.status)).toHaveFocus();
    fireEvent.keyDown(cellOf('row-heater', PROPS.status), { key: 'ArrowRight' });
    expect(cellOf('row-heater', PROPS.priority)).toHaveFocus();
    fireEvent.keyDown(cellOf('row-heater', PROPS.priority), { key: 'End' });
    expect(cellOf('row-heater', PROPS.notes)).toHaveFocus();
    fireEvent.keyDown(cellOf('row-heater', PROPS.notes), { key: 'Tab' });
    expect(cellOf('row-boiler', PROPS.name)).toHaveFocus();
    fireEvent.keyDown(cellOf('row-boiler', PROPS.name), { key: 'Tab', shiftKey: true });
    expect(cellOf('row-heater', PROPS.notes)).toHaveFocus();
    fireEvent.keyDown(cellOf('row-heater', PROPS.notes), { key: 'Home', ctrlKey: true });
    expect(cellOf('row-sink', PROPS.name)).toHaveFocus();
    fireEvent.keyDown(cellOf('row-sink', PROPS.name), { key: 'ArrowUp' });
    expect(cellOf('row-sink', PROPS.name)).toHaveFocus();
  });

  it('makes only one cell a tab stop', () => {
    render(<TableLayout {...layoutProps()} />);
    const stops = document.querySelectorAll(
      '[role="gridcell"][tabindex="0"], [role="rowheader"][tabindex="0"]',
    );
    expect(stops).toHaveLength(1);
    expect(cellOf('row-sink', PROPS.name)).toHaveAttribute('tabindex', '0');
  });

  it('edits with Enter or by typing, and clears with Delete', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.keyDown(cellOf('row-heater', PROPS.notes), { key: 'Enter' });
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: 'Escape' });
    fireEvent.keyDown(cellOf('row-heater', PROPS.notes), { key: 'C' });
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('C');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: 'Escape' });
    fireEvent.keyDown(cellOf('row-sink', PROPS.cost), { key: 'Delete' });
    expect(props.actions.updateValues).toHaveBeenCalledWith('row-sink', { [PROPS.cost]: null });
  });

  it('opens the row with Space on its Name and ticks a checkbox with Space', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.keyDown(cellOf('row-boiler', PROPS.name), { key: ' ' });
    expect(props.actions.openRow).toHaveBeenCalledWith('row-boiler');
    fireEvent.keyDown(cellOf('row-boiler', PROPS.paid), { key: ' ' });
    expect(props.actions.updateValues).toHaveBeenCalledWith('row-boiler', { [PROPS.paid]: false });
  });
});
