import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@carehub/ui';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  jobsDatabase,
  jobsRows,
  layoutProps,
  PRIORITY,
  PROPS,
  queryData,
  renderWithDatabase,
  USERS,
  viewData,
} from '../test-utils';
import TableLayout from './layout';

const cellOf = (rowId: string, propertyId: string): HTMLElement => {
  const row = document.querySelector(`[role="row"][data-row-id="${rowId}"]`);
  const cell = row?.querySelector<HTMLElement>(`[data-property-id="${propertyId}"]`);
  if (!cell) throw new Error(`No cell ${propertyId} in ${rowId}`);
  return cell;
};

const paste = (element: HTMLElement, text: string) =>
  fireEvent.paste(element, { clipboardData: { getData: () => text } });

const typeOption = (name: string) => {
  fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole('option', { name: `Create ${name}` }));
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('TableLayout new options', () => {
  it('saves an option typed into a Select cell with the value; redo adds it again', () => {
    const { actions, ...props } = layoutProps();
    renderWithDatabase(<TableLayout {...props} actions={actions} />);
    fireEvent.click(cellOf('row-sink', PROPS.priority));
    typeOption('Urgent');

    const [rowId, values, newOptions] = actions.updateValues.mock.calls[0] ?? [];
    const urgent = newOptions?.[PROPS.priority]?.[0];
    expect(rowId).toBe('row-sink');
    expect(urgent).toMatchObject({ name: 'Urgent' });
    expect(values).toEqual({ [PROPS.priority]: urgent?.id });
    expect(actions.addOptions).not.toHaveBeenCalled();

    fireEvent.keyDown(cellOf('row-sink', PROPS.priority), { key: 'z', ctrlKey: true });
    expect(actions.updateValues).toHaveBeenLastCalledWith('row-sink', {
      [PROPS.priority]: PRIORITY.high,
    });
    // The property still doesn't have it here (no answer came back), so redo sends it again.
    fireEvent.keyDown(cellOf('row-sink', PROPS.priority), { key: 'y', ctrlKey: true });
    expect(actions.updateValues).toHaveBeenLastCalledWith('row-sink', values, newOptions);
  });

  it('adds an option typed into Set property once, then sets every ticked row', async () => {
    const { actions, ...props } = layoutProps();
    renderWithDatabase(<TableLayout {...props} actions={actions} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Fix kitchen sink leak' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Annual boiler service' }));
    const bar = screen.getByRole('toolbar', { name: 'Selected rows' });
    fireEvent.keyDown(within(bar).getByRole('button', { name: 'Set property' }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Priority' }));
    typeOption('Urgent');

    expect(actions.addOptions).toHaveBeenCalledTimes(1);
    const [propertyId, options] = actions.addOptions.mock.calls[0] ?? [];
    expect(propertyId).toBe(PROPS.priority);
    expect(options).toEqual([expect.objectContaining({ name: 'Urgent' })]);
    const id = options?.[0]?.id;
    await waitFor(() => expect(actions.updateValues).toHaveBeenCalledTimes(2));
    expect(actions.updateValues.mock.calls).toEqual([
      ['row-sink', { [PROPS.priority]: id }],
      ['row-boiler', { [PROPS.priority]: id }],
    ]);
  });

  it('adds options pasted names need once each, then fills the cells with the saved ids', async () => {
    const { actions, ...props } = layoutProps();
    // The server had an option of that name already.
    actions.addOptions.mockImplementation(async (_propertyId, options) =>
      Object.fromEntries(options.map((o) => [o.id, 'opt-urgent-saved'])),
    );
    renderWithDatabase(<TableLayout {...props} actions={actions} />);
    paste(cellOf('row-sink', PROPS.priority), 'Urgent\nurgent\nLow');

    expect(actions.addOptions).toHaveBeenCalledTimes(1);
    expect(actions.addOptions.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ name: 'Urgent' }),
    ]);
    expect(actions.updateValues).not.toHaveBeenCalled();
    // The boiler service is Low already.
    await waitFor(() => expect(actions.updateValues).toHaveBeenCalledTimes(2));
    expect(actions.updateValues.mock.calls).toEqual([
      ['row-sink', { [PROPS.priority]: 'opt-urgent-saved' }],
      ['row-heater', { [PROPS.priority]: 'opt-urgent-saved' }],
    ]);
  });

  it('skips pasted names that need options when the options can’t be added', async () => {
    const meta = { ...jobsDatabase(), viewerAccess: 'edit_content' as const };
    const { actions, ...props } = layoutProps({ meta });
    renderWithDatabase(
      <ToastProvider>
        <TableLayout {...props} actions={actions} />
      </ToastProvider>,
    );
    paste(cellOf('row-sink', PROPS.priority), 'Urgent\nLow');
    expect(actions.addOptions).not.toHaveBeenCalled();
    expect(actions.updateValues.mock.calls).toEqual([
      ['row-heater', { [PROPS.priority]: PRIORITY.low }],
    ]);
    expect(await screen.findByText("1 value didn't fit and was skipped.")).toBeInTheDocument();
  });
});

describe('TableLayout people', () => {
  it('lists the workspace’s people in a Person cell', async () => {
    const { actions, ...props } = layoutProps();
    renderWithDatabase(<TableLayout {...props} actions={actions} />);
    fireEvent.click(cellOf('row-drain', PROPS.technician));
    expect(actions.searchPeople).toHaveBeenCalledWith('');
    fireEvent.click(await screen.findByRole('option', { name: /Jordan Park/ }));
    expect(actions.updateValues).toHaveBeenCalledWith('row-drain', {
      [PROPS.technician]: [USERS.jordan.id],
    });
  });

  it('pastes people by name or email, ignoring case', async () => {
    // No names in the answer: the workspace's people are looked up.
    const data = viewData(queryData(jobsRows(), { people: {} }));
    const { actions, ...props } = layoutProps({ data });
    renderWithDatabase(<TableLayout {...props} actions={actions} />);
    paste(cellOf('row-heater', PROPS.technician), 'avery lin\nJORDAN.PARK@bluepine.example');
    expect(actions.searchPeople).toHaveBeenCalledWith('');
    await waitFor(() => expect(actions.updateValues).toHaveBeenCalledTimes(2));
    expect(actions.updateValues.mock.calls).toEqual([
      ['row-heater', { [PROPS.technician]: [USERS.avery.id] }],
      ['row-boiler', { [PROPS.technician]: [USERS.jordan.id] }],
    ]);
  });
});
