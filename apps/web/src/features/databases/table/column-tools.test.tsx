import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { View, ViewPropertySetting } from '@carehub/databases';
import { jobsDatabase, layoutProps, PROPS } from '../test-utils';
import TableLayout from './layout';

function tableView(patch: Partial<View> = {}): View {
  const view = jobsDatabase().views[0];
  if (!view) throw new Error('The fixture needs a table view.');
  return { ...view, ...patch };
}

const header = (name: string) => screen.getByRole('columnheader', { name });
const headerButton = (name: string) => within(header(name)).getByRole('button', { name });

function pointer(target: Element | Window, type: string, clientX: number) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
}

/** Presses at `from`, moves to `to` and lets go (px from the table's left edge). */
function drag(element: Element, from: number, to: number) {
  pointer(element, 'pointerdown', from);
  pointer(window, 'pointermove', (from + to) / 2);
  pointer(window, 'pointermove', to);
  pointer(window, 'pointerup', to);
}

function savedPatch(props: ReturnType<typeof layoutProps>): Partial<View> {
  const patch = props.actions.updateView.mock.calls.at(-1)?.[0];
  if (!patch) throw new Error('Nothing was saved.');
  return patch;
}

const setting = (patch: Partial<View>, propertyId: string): ViewPropertySetting | undefined =>
  patch.properties?.find((s) => s.propertyId === propertyId);

beforeEach(() => {
  window.localStorage.clear();
});

describe('TableLayout column tools', () => {
  it('resizes a column by dragging its edge, between 80 and 800 px', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    const handle = header('Cost').querySelector('[data-resize-handle]');
    if (!handle) throw new Error('No resize handle');
    pointer(handle, 'pointerdown', 500);
    pointer(window, 'pointermove', 560);
    expect(header('Cost')).toHaveStyle({ width: '260px' });
    pointer(window, 'pointerup', 560);
    expect(setting(savedPatch(props), PROPS.cost)?.width).toBe(260);

    const notes = header('Notes').querySelector('[data-resize-handle]');
    if (!notes) throw new Error('No resize handle');
    drag(notes, 500, -400);
    expect(setting(savedPatch(props), PROPS.notes)?.width).toBe(80);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('changes a column from its menu: wrap, freeze, hide and a typed width', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(headerButton('Status'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Wrap column' }));
    expect(setting(savedPatch(props), PROPS.status)?.wrap).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(headerButton('Status'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Freeze up to here' }));
    expect(savedPatch(props).table?.frozenUpTo).toBe(PROPS.status);

    fireEvent.click(headerButton('Status'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide in this view' }));
    expect(setting(savedPatch(props), PROPS.status)?.visible).toBe(false);

    fireEvent.click(headerButton('Status'));
    const width = screen.getByRole('spinbutton', { name: 'Width' });
    expect(width).toHaveValue(200);
    fireEvent.change(width, { target: { value: '330' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    expect(setting(savedPatch(props), PROPS.status)?.width).toBe(330);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it("doesn't offer to hide Name", () => {
    render(<TableLayout {...layoutProps()} />);
    fireEvent.click(headerButton('Name'));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Wrap column' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Hide in this view' })).toBeNull();
  });

  it('keeps quick changes to two columns', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    fireEvent.click(headerButton('Status'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Wrap column' }));
    fireEvent.click(headerButton('Cost'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Wrap column' }));
    const patch = savedPatch(props);
    expect(setting(patch, PROPS.status)?.wrap).toBe(true);
    expect(setting(patch, PROPS.cost)?.wrap).toBe(true);
  });

  it('moves a column dragged by its header, and Name stays first', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    // Name 0–280, Status 280–480, ..., Cost 1080–1280.
    drag(headerButton('Cost'), 1100, 300);
    const order = savedPatch(props).properties?.map((s) => s.propertyId) ?? [];
    expect(order.indexOf(PROPS.cost)).toBe(order.indexOf(PROPS.status) - 1);
    fireEvent.click(headerButton('Cost'));
    expect(screen.queryByRole('menu')).toBeNull();

    // Nothing goes before Name: dropped at the far left, Status stays where it is.
    drag(headerButton('Status'), 300, 20);
    expect(props.actions.updateView).toHaveBeenCalledTimes(1);
  });

  it('shows and hides columns in the Properties menu, and wraps all cells', () => {
    const view = tableView({
      properties: [
        { propertyId: PROPS.name, visible: true },
        { propertyId: PROPS.status, visible: true, wrap: false },
      ],
    });
    const props = layoutProps({ view });
    render(<TableLayout {...props} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Properties' }), { key: 'Enter' });
    expect(screen.getByRole('menuitemcheckbox', { name: 'Status' })).toBeChecked();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Cost' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Cost' }));
    expect(savedPatch(props).properties?.at(-1)).toEqual({ propertyId: PROPS.cost, visible: true });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Wrap cells' }));
    const patch = savedPatch(props);
    expect(patch.table?.wrapCells).toBe(true);
    expect(setting(patch, PROPS.status)).toEqual({ propertyId: PROPS.status, visible: true });
    expect(setting(patch, PROPS.cost)?.visible).toBe(true);
  });

  it('sets a calculation from the footer', () => {
    const props = layoutProps();
    render(<TableLayout {...props} />);
    const cost = screen
      .getByTestId('db-totals')
      .querySelector(`[data-property-id="${PROPS.cost}"]`);
    if (!(cost instanceof HTMLElement)) throw new Error('No Cost total');
    fireEvent.keyDown(within(cost).getByRole('button', { name: 'Calculate' }), { key: 'Enter' });
    expect(screen.getByRole('menuitemradio', { name: 'None' })).toBeChecked();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Sum' }));
    expect(savedPatch(props).calculations).toEqual({ [PROPS.cost]: 'sum' });
  });

  it("leaves the columns alone for someone who can't edit the view", () => {
    const meta = { ...jobsDatabase(), viewerAccess: 'edit_content' as const };
    render(<TableLayout {...layoutProps({ meta })} />);
    const columns = screen
      .getAllByRole('columnheader')
      .filter((h) => h.hasAttribute('data-property-id'));
    expect(columns).toHaveLength(8);
    expect(within(header('Status')).queryByRole('button')).toBeNull();
    expect(document.querySelector('[data-resize-handle]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Properties' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Calculate' })).toBeNull();
    expect(screen.queryByTestId('db-totals')).toBeNull();
  });
});

describe('TableLayout groups and options', () => {
  it('remembers collapsed groups for the person', () => {
    const view = tableView({ grouping: { propertyId: PROPS.status } });
    const first = render(<TableLayout {...layoutProps({ view })} />);
    const group = screen.getByRole('rowgroup', { name: 'In progress' });
    fireEvent.click(within(group).getByRole('button', { name: /In progress/ }));
    first.unmount();
    render(<TableLayout {...layoutProps({ view })} />);
    const again = screen.getByRole('rowgroup', { name: 'In progress' });
    expect(within(again).getByRole('button', { name: /In progress/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(again.querySelector('[data-row-id]')).toBeNull();
  });

  it("doesn't offer new options to someone who can't change properties", () => {
    const meta = { ...jobsDatabase(), viewerAccess: 'edit_content' as const };
    render(<TableLayout {...layoutProps({ meta, view: tableView() })} />);
    const status = screen.getAllByRole('gridcell').find((c) => c.textContent === 'High');
    if (!status) throw new Error('No Priority cell');
    fireEvent.click(status);
    fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), {
      target: { value: 'Urgent' },
    });
    expect(screen.queryByRole('option', { name: 'Create Urgent' })).toBeNull();
  });
});
