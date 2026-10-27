import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@carehub/ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureRow, layoutProps, PRIORITY, PROPS, STATUS } from '../test-utils';
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

const focused = () => document.activeElement as HTMLElement;

/** The cells in the block, as "row:property". */
const block = () =>
  [...document.querySelectorAll('[aria-selected="true"][data-property-id]')].map(
    (cell) =>
      `${cell.closest('[role="row"]')?.getAttribute('data-row-id')}:${cell.getAttribute('data-property-id')}`,
  );

/** What a copy on the element puts on the clipboard. */
const copied = (element: HTMLElement): string => {
  let text = '';
  fireEvent.copy(element, {
    clipboardData: { setData: (_type: string, value: string) => (text = value) },
  });
  return text;
};

const paste = (element: HTMLElement, text: string) =>
  fireEvent.paste(element, { clipboardData: { getData: () => text } });

const undo = (element: HTMLElement) => fireEvent.keyDown(element, { key: 'z', ctrlKey: true });
const redo = (element: HTMLElement) =>
  fireEvent.keyDown(element, { key: 'z', ctrlKey: true, shiftKey: true });

/** Mocked actions whose createRow gives row-new-1, row-new-2, ... */
function editingProps(readOnly = false) {
  const props = layoutProps({ readOnly });
  let made = 0;
  props.actions.createRow.mockImplementation(async (input) => {
    made += 1;
    return fixtureRow(`row-new-${made}`, input?.title ?? '', 4 + made, input?.values ?? {});
  });
  return props;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('TableLayout blocks of cells and copying', () => {
  it('makes a block with Shift+arrows and copies it as tab-separated text', () => {
    render(<TableLayout {...layoutProps()} />);
    fireEvent.keyDown(cellOf('row-sink', PROPS.name), { key: 'ArrowRight' });
    fireEvent.keyDown(cellOf('row-sink', PROPS.status), { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(cellOf('row-heater', PROPS.status), { key: 'ArrowRight', shiftKey: true });
    expect(cellOf('row-heater', PROPS.priority)).toHaveFocus();
    expect(block()).toEqual([
      `row-sink:${PROPS.status}`,
      `row-sink:${PROPS.priority}`,
      `row-heater:${PROPS.status}`,
      `row-heater:${PROPS.priority}`,
    ]);
    expect(copied(focused())).toBe('In progress\tHigh\nNot started\tHigh');

    fireEvent.keyDown(focused(), { key: 'Escape' });
    expect(block()).toEqual([]);
  });

  it('makes a block with Shift-click, without opening an editor', () => {
    render(<TableLayout {...layoutProps()} />);
    fireEvent.keyDown(cellOf('row-sink', PROPS.name), { key: 'ArrowRight' });
    fireEvent.click(cellOf('row-boiler', PROPS.due), { shiftKey: true });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(block()).toHaveLength(9);
    expect(cellOf('row-boiler', PROPS.due)).toHaveFocus();
  });

  it('copies one cell as exports write it', () => {
    render(<TableLayout {...layoutProps()} />);
    expect(copied(cellOf('row-sink', PROPS.cost))).toBe('$180.00');
    expect(copied(cellOf('row-sink', PROPS.paid))).toBe('No');
    expect(copied(cellOf('row-sink', PROPS.priority))).toBe('High');
  });
});

describe('TableLayout pasting, undo and redo', () => {
  it('pastes a 5 × 3 block: fills cells, adds rows, counts what didn’t fit; Ctrl+Z undoes it', async () => {
    const props = editingProps();
    const { actions } = props;
    render(
      <ToastProvider>
        <TableLayout {...props} />
      </ToastProvider>,
    );
    const clip = [
      'Annual boiler check\tDone\tLow',
      'Clear drain\tIn progress\tHigh',
      'Fit new tap\tNot started\tMedium',
      'Bleed radiators\t\tLow',
      'Service pump\tDone\tUrgent',
    ].join('\r\n');
    paste(cellOf('row-boiler', PROPS.name), clip);

    expect(actions.updateValues.mock.calls).toEqual([
      ['row-boiler', { [PROPS.name]: 'Annual boiler check' }],
      [
        'row-drain',
        {
          [PROPS.name]: 'Clear drain',
          [PROPS.status]: STATUS.inProgress,
          [PROPS.priority]: PRIORITY.high,
        },
      ],
    ]);
    await waitFor(() => expect(actions.createRow).toHaveBeenCalledTimes(3));
    expect(actions.createRow.mock.calls).toEqual([
      [
        {
          title: 'Fit new tap',
          values: { [PROPS.status]: STATUS.notStarted, [PROPS.priority]: PRIORITY.medium },
          templateId: null,
        },
      ],
      [{ title: 'Bleed radiators', values: { [PROPS.priority]: PRIORITY.low }, templateId: null }],
      [{ title: 'Service pump', values: { [PROPS.status]: STATUS.done }, templateId: null }],
    ]);
    expect(await screen.findByText("1 value didn't fit and was skipped.")).toBeInTheDocument();
    await waitFor(() => expect(rowOf('row-new-3')).toBeInTheDocument());

    undo(cellOf('row-boiler', PROPS.name));
    expect(actions.updateValues.mock.calls.slice(2)).toEqual([
      ['row-boiler', { [PROPS.name]: 'Annual boiler service' }],
      [
        'row-drain',
        {
          [PROPS.name]: 'Unclog bathroom drain',
          [PROPS.status]: STATUS.notStarted,
          [PROPS.priority]: PRIORITY.medium,
        },
      ],
    ]);
    expect(actions.trashRows).toHaveBeenCalledWith(['row-new-1', 'row-new-2', 'row-new-3']);
    expect(document.querySelector('[data-row-id="row-new-1"]')).toBeNull();
    expect(cellOf('row-boiler', PROPS.name)).toHaveFocus();

    redo(cellOf('row-boiler', PROPS.name));
    await waitFor(() => expect(actions.createRow).toHaveBeenCalledTimes(6));
    expect(actions.updateValues).toHaveBeenLastCalledWith('row-drain', {
      [PROPS.name]: 'Clear drain',
      [PROPS.status]: STATUS.inProgress,
      [PROPS.priority]: PRIORITY.high,
    });
    await waitFor(() => expect(rowOf('row-new-6')).toBeInTheDocument());
    undo(cellOf('row-boiler', PROPS.name));
    expect(actions.trashRows).toHaveBeenLastCalledWith(['row-new-4', 'row-new-5', 'row-new-6']);
  });

  it('fills a block with one pasted value', () => {
    const props = editingProps();
    render(<TableLayout {...props} />);
    fireEvent.keyDown(cellOf('row-sink', PROPS.name), { key: 'ArrowRight' });
    fireEvent.keyDown(cellOf('row-sink', PROPS.status), { key: 'ArrowRight' });
    fireEvent.keyDown(cellOf('row-sink', PROPS.priority), { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(cellOf('row-heater', PROPS.priority), { key: 'ArrowDown', shiftKey: true });
    paste(focused(), 'low\n');
    // The boiler is Low already.
    expect(props.actions.updateValues.mock.calls).toEqual([
      ['row-sink', { [PROPS.priority]: PRIORITY.low }],
      ['row-heater', { [PROPS.priority]: PRIORITY.low }],
    ]);
  });

  it('clears a block with Delete in one step; Ctrl+Z and Ctrl+Y', () => {
    const props = editingProps();
    const { updateValues } = props.actions;
    render(<TableLayout {...props} />);
    fireEvent.keyDown(cellOf('row-sink', PROPS.name), { key: 'ArrowRight' });
    fireEvent.keyDown(cellOf('row-sink', PROPS.status), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(cellOf('row-sink', PROPS.priority), { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(focused(), { key: 'Delete' });
    expect(updateValues.mock.calls).toEqual([
      ['row-sink', { [PROPS.status]: null, [PROPS.priority]: null }],
      ['row-heater', { [PROPS.status]: null, [PROPS.priority]: null }],
    ]);
    undo(focused());
    expect(updateValues.mock.calls.slice(2)).toEqual([
      ['row-sink', { [PROPS.status]: STATUS.inProgress, [PROPS.priority]: PRIORITY.high }],
      ['row-heater', { [PROPS.status]: STATUS.notStarted, [PROPS.priority]: PRIORITY.high }],
    ]);
    fireEvent.keyDown(focused(), { key: 'y', ctrlKey: true });
    expect(updateValues).toHaveBeenCalledTimes(6);
    undo(focused());
    undo(focused());
    expect(updateValues).toHaveBeenCalledTimes(8);
  });

  it('undoes a cleared cell and puts focus back on it', () => {
    const props = editingProps();
    render(<TableLayout {...props} />);
    fireEvent.keyDown(cellOf('row-sink', PROPS.cost), { key: 'Delete' });
    expect(props.actions.updateValues).toHaveBeenLastCalledWith('row-sink', { [PROPS.cost]: null });
    undo(cellOf('row-heater', PROPS.name));
    expect(props.actions.updateValues).toHaveBeenLastCalledWith('row-sink', {
      [PROPS.cost]: '180',
    });
    expect(cellOf('row-sink', PROPS.cost)).toHaveFocus();
  });

  it('read-only: copies, but pastes and undoes nothing', () => {
    const props = editingProps(true);
    render(<TableLayout {...props} />);
    expect(copied(cellOf('row-sink', PROPS.priority))).toBe('High');
    paste(cellOf('row-sink', PROPS.priority), 'Low');
    undo(cellOf('row-sink', PROPS.priority));
    expect(props.actions.updateValues).not.toHaveBeenCalled();
  });
});
