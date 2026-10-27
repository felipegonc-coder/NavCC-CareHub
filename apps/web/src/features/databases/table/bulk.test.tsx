import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { jobsDatabase, layoutProps, PRIORITY, PROPS } from '../test-utils';
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

const selectCell = (rowId: string): HTMLElement => {
  const cell = rowOf(rowId).querySelector<HTMLElement>('[data-select-cell]');
  if (!cell) throw new Error(`No selection cell in ${rowId}`);
  return cell;
};

const tickBox = (title: string) => screen.getByRole('checkbox', { name: `Select ${title}` });
const ticked = () =>
  [...document.querySelectorAll('[role="row"][aria-selected="true"]')].map((r) =>
    r.getAttribute('data-row-id'),
  );
const bar = () => screen.getByRole('toolbar', { name: 'Selected rows' });

beforeEach(() => {
  window.localStorage.clear();
});

describe('TableLayout selection', () => {
  it('ticks rows, Shift-clicks a range and ticks all from the header', () => {
    render(<TableLayout {...layoutProps()} />);
    expect(screen.queryByRole('toolbar', { name: 'Selected rows' })).toBeNull();
    fireEvent.click(tickBox('Fix kitchen sink leak'));
    expect(ticked()).toEqual(['row-sink']);
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(tickBox('Annual boiler service'), { shiftKey: true });
    expect(ticked()).toEqual(['row-sink', 'row-heater', 'row-boiler']);
    expect(within(bar()).getByText('3 selected')).toBeInTheDocument();

    const all = screen.getByRole('checkbox', { name: 'Select all rows' });
    expect(all).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(all);
    expect(ticked()).toEqual(['row-sink', 'row-heater', 'row-boiler', 'row-drain']);
    expect(all).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(all);
    expect(ticked()).toEqual([]);
  });

  it('ticks rows from the keyboard, Ctrl+A ticks all and Escape clears', () => {
    render(<TableLayout {...layoutProps()} />);
    fireEvent.keyDown(cellOf('row-sink', PROPS.name), { key: 'ArrowLeft' });
    expect(selectCell('row-sink')).toHaveFocus();
    fireEvent.keyDown(selectCell('row-sink'), { key: ' ' });
    fireEvent.keyDown(selectCell('row-sink'), { key: 'ArrowDown' });
    fireEvent.keyDown(selectCell('row-heater'), { key: 'ArrowDown' });
    fireEvent.keyDown(selectCell('row-boiler'), { key: ' ', shiftKey: true });
    expect(ticked()).toEqual(['row-sink', 'row-heater', 'row-boiler']);
    fireEvent.keyDown(selectCell('row-boiler'), { key: 'ArrowRight' });
    expect(cellOf('row-boiler', PROPS.name)).toHaveFocus();

    fireEvent.keyDown(cellOf('row-boiler', PROPS.name), { key: 'Escape' });
    expect(ticked()).toEqual([]);
    fireEvent.keyDown(cellOf('row-boiler', PROPS.status), { key: 'a', ctrlKey: true });
    expect(ticked()).toHaveLength(4);
    fireEvent.keyDown(cellOf('row-boiler', PROPS.status), { key: 'Escape' });
    expect(ticked()).toEqual([]);
  });

  it('ticks the rows on the way with Shift+arrows in the selection column', () => {
    render(<TableLayout {...layoutProps()} />);
    fireEvent.keyDown(cellOf('row-sink', PROPS.name), { key: 'ArrowLeft' });
    fireEvent.keyDown(selectCell('row-sink'), { key: 'ArrowDown', shiftKey: true });
    expect(ticked()).toEqual(['row-sink', 'row-heater']);
    expect(selectCell('row-heater')).toHaveFocus();
    fireEvent.keyDown(selectCell('row-heater'), { key: 'ArrowDown', shiftKey: true });
    expect(ticked()).toEqual(['row-sink', 'row-heater', 'row-boiler']);
    fireEvent.keyDown(selectCell('row-boiler'), { key: 'ArrowUp', shiftKey: true });
    expect(ticked()).toEqual(['row-sink', 'row-heater']);
  });

  it('moves the ticked rows to Trash with Delete', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(tickBox('Fix kitchen sink leak'));
    fireEvent.click(tickBox('Replace water heater'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }));
    expect(props.actions.trashRows).toHaveBeenCalledWith(['row-sink', 'row-heater']);
    expect(screen.queryByRole('toolbar', { name: 'Selected rows' })).toBeNull();
  });

  it('sets one property for every ticked row', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(tickBox('Fix kitchen sink leak'));
    fireEvent.click(tickBox('Annual boiler service'));
    fireEvent.keyDown(within(bar()).getByRole('button', { name: 'Set property' }), {
      key: 'Enter',
    });
    expect(screen.queryByRole('menuitem', { name: 'Name' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Priority' }));
    fireEvent.click(screen.getByRole('option', { name: 'Low' }));
    // The boiler service is Low already.
    expect(props.actions.updateValues).toHaveBeenCalledTimes(1);
    expect(props.actions.updateValues).toHaveBeenCalledWith('row-sink', {
      [PROPS.priority]: PRIORITY.low,
    });
  });

  it('lets Can edit content tick rows, but not Can view or read-only', () => {
    const editor = { ...jobsDatabase(), viewerAccess: 'edit_content' as const };
    const first = render(<TableLayout {...layoutProps({ meta: editor })} />);
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toBeInTheDocument();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-multiselectable', 'true');
    first.unmount();

    const viewer = { ...jobsDatabase(), viewerAccess: 'view' as const };
    const second = render(<TableLayout {...layoutProps({ meta: viewer })} />);
    expect(screen.queryByRole('checkbox', { name: 'Select all rows' })).toBeNull();
    second.unmount();

    render(<TableLayout {...layoutProps({ readOnly: true })} />);
    expect(screen.queryByRole('checkbox', { name: 'Select all rows' })).toBeNull();
    expect(document.querySelector('[data-select-cell]')).toBeNull();
    expect(rowOf('row-sink')).not.toHaveAttribute('aria-selected');
  });
});
