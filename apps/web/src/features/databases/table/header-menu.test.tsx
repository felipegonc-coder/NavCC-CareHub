import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { View } from '@carehub/databases';
import { jobsDatabase, layoutProps, PROPS, renderWithDatabase } from '../test-utils';
import TableLayout from './layout';

function tableView(patch: Partial<View> = {}): View {
  const view = jobsDatabase().views[0];
  if (!view) throw new Error('The fixture needs a table view.');
  return { ...view, ...patch };
}

const header = (name: string) => screen.getByRole('columnheader', { name });
const headerButton = (name: string) => within(header(name)).getByRole('button', { name });

const cellOf = (rowId: string, propertyId: string): HTMLElement => {
  const cell = document.querySelector<HTMLElement>(
    `[role="row"][data-row-id="${rowId}"] [data-property-id="${propertyId}"]`,
  );
  if (!cell) throw new Error(`No cell ${propertyId} in ${rowId}`);
  return cell;
};

function savedPatch(props: ReturnType<typeof layoutProps>): Partial<View> {
  const patch = props.actions.updateView.mock.calls.at(-1)?.[0];
  if (!patch) throw new Error('Nothing was saved.');
  return patch;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('TableLayout column menus', () => {
  it('sorts by a column: it goes first and the other sorts stay after it', () => {
    const view = tableView({ sorts: [{ propertyId: PROPS.status, direction: 'asc' }] });
    const props = layoutProps({ view });
    renderWithDatabase(<TableLayout {...props} />);
    fireEvent.click(headerButton('Cost'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort descending' }));
    expect(savedPatch(props).sorts).toEqual([
      { propertyId: PROPS.cost, direction: 'desc' },
      { propertyId: PROPS.status, direction: 'asc' },
    ]);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(headerButton('Status'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort descending' }));
    expect(savedPatch(props).sorts).toEqual([
      { propertyId: PROPS.status, direction: 'desc' },
      { propertyId: PROPS.cost, direction: 'desc' },
    ]);
  });

  it('groups by a column, and a ticked Group by ungroups', () => {
    const props = layoutProps();
    const { unmount } = renderWithDatabase(<TableLayout {...props} />);
    fireEvent.click(headerButton('Status'));
    const groupBy = screen.getByRole('menuitemcheckbox', { name: 'Group by' });
    expect(groupBy).not.toBeChecked();
    fireEvent.click(groupBy);
    expect(savedPatch(props).grouping).toEqual({ propertyId: PROPS.status });
    unmount();

    const grouped = layoutProps({ view: tableView({ grouping: { propertyId: PROPS.status } }) });
    renderWithDatabase(<TableLayout {...grouped} />);
    fireEvent.click(headerButton('Status'));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Group by' })).toBeChecked();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Group by' }));
    expect(savedPatch(grouped).grouping).toBeNull();
  });

  it("sets a column's calculation from its menu", () => {
    const props = layoutProps();
    renderWithDatabase(<TableLayout {...props} />);
    fireEvent.click(headerButton('Cost'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Calculate' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Sum' }));
    expect(savedPatch(props).calculations).toEqual({ [PROPS.cost]: 'sum' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it("opens the Filter panel at the column's property, from its header", async () => {
    const props = layoutProps();
    renderWithDatabase(<TableLayout {...props} />);
    fireEvent.click(headerButton('Status'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Filter' }));
    // Once the menu has closed and given focus back to the header (the panel takes it from there).
    await waitFor(() => expect(props.actions.openPanel).toHaveBeenCalledTimes(1));
    expect(props.actions.openPanel).toHaveBeenCalledWith(
      'filter',
      { propertyId: PROPS.status },
      headerButton('Status'),
    );
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers Sort for Name but not Group by', () => {
    renderWithDatabase(<TableLayout {...layoutProps()} />);
    fireEvent.click(headerButton('Name'));
    expect(screen.getByRole('menuitem', { name: 'Sort ascending' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Group by' })).toBeNull();
  });

  it('people who can only view filter, sort and group (for themselves), and change nothing else', () => {
    const props = layoutProps({
      meta: { ...jobsDatabase(), viewerAccess: 'view' },
      view: tableView({ sorts: [] }),
      readOnly: true,
    });
    renderWithDatabase(<TableLayout {...props} />);
    expect(header('Status').querySelector('[data-resize-handle]')).toBeNull();
    fireEvent.click(headerButton('Status'));
    expect(screen.queryByRole('textbox', { name: 'Property name' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Width' })).toBeNull();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Wrap column' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Hide in this view' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Calculate' })).toBeNull();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Group by' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Filter' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort ascending' }));
    expect(savedPatch(props).sorts).toEqual([{ propertyId: PROPS.status, direction: 'asc' }]);
  });

  it("forgets a deleted column's values: undo doesn't write them back", async () => {
    const props = layoutProps();
    const { client } = renderWithDatabase(<TableLayout {...props} />);
    fireEvent.keyDown(cellOf('row-sink', PROPS.cost), { key: 'Delete' });
    expect(props.actions.updateValues).toHaveBeenCalledTimes(1);

    fireEvent.click(headerButton('Cost'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(client.deleteProperty).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.keyDown(cellOf('row-heater', PROPS.name), { key: 'z', ctrlKey: true });
    expect(props.actions.updateValues).toHaveBeenCalledTimes(1);
  });
});
