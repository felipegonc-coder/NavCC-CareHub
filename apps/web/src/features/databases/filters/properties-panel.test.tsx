import type { DatabaseMeta, View, ViewPropertySetting } from '@carehub/databases';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JOBS_ID, jobsDatabase, PROPS, testViewer, VIEWS } from '../fixtures';
import { mockActions, mockClient, renderWithDatabase } from '../test-utils';
import { PropertiesPanel } from './properties-panel';

const shown = (propertyId: string, width?: number): ViewPropertySetting =>
  width === undefined ? { propertyId, visible: true } : { propertyId, visible: true, width };
const off = (propertyId: string): ViewPropertySetting => ({ propertyId, visible: false });

// Name, then Cost and Status shown; Paid listed but hidden; the rest not listed.
const SETTINGS: ViewPropertySetting[] = [
  shown(PROPS.name, 280),
  shown(PROPS.cost, 120),
  off(PROPS.paid),
  shown(PROPS.status),
];

function show(
  options: {
    viewId?: string;
    change?: Partial<View>;
    canEditViews?: boolean;
    meta?: DatabaseMeta;
    propertyIds?: string[];
  } = {},
) {
  const meta = options.meta ?? jobsDatabase();
  const base = meta.views.find((v) => v.id === (options.viewId ?? VIEWS.table));
  if (!base) throw new Error('No view');
  const view: View = { ...base, properties: SETTINGS, ...options.change };
  const actions = mockActions();
  const client = mockClient();
  client.getDatabase.mockResolvedValue(jobsDatabase(meta));
  renderWithDatabase(
    <PropertiesPanel
      meta={meta}
      view={view}
      viewer={testViewer()}
      actions={actions}
      canEditViews={options.canEditViews ?? true}
      propertyIds={options.propertyIds}
    />,
    { client },
  );
  return { actions, client };
}

const labels = (list: string) =>
  within(screen.getByRole('list', { name: list }))
    .queryAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));
const sent = (actions: ReturnType<typeof mockActions>) => actions.updateView.mock.lastCall?.[0];

describe('Properties panel', () => {
  it("lists Name first, the shown properties in the view's order, then the hidden ones", () => {
    show();
    const shownList = screen.getByRole('list', { name: 'Shown in this view' });
    expect(within(shownList).getAllByRole('listitem')[0]).toHaveTextContent('NameAlways shown');
    expect(labels('Shown in this view')).toEqual([
      'Width and wrap of Name',
      'Move Cost',
      'Width and wrap of Cost',
      'Hide Cost',
      'Move Status',
      'Width and wrap of Status',
      'Hide Status',
    ]);
    expect(labels('Hidden in this view')).toEqual([
      'Show Priority',
      'Show Due date',
      'Show Technician',
      'Show Paid',
      'Show Notes',
    ]);
  });

  it('hides a property, then shows it again at the end', () => {
    const { actions } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Cost' }));
    expect(sent(actions)).toEqual({
      properties: [
        shown(PROPS.name, 280),
        shown(PROPS.status),
        { propertyId: PROPS.cost, visible: false, width: 120 },
        off(PROPS.paid),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show Cost' }));
    expect(sent(actions)).toEqual({
      properties: [
        shown(PROPS.name, 280),
        shown(PROPS.status),
        shown(PROPS.cost, 120),
        off(PROPS.paid),
      ],
    });
  });

  it('shows all and hides all', () => {
    const { actions } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(sent(actions)?.properties?.map((s) => [s.propertyId, s.visible])).toEqual([
      [PROPS.name, true],
      [PROPS.cost, true],
      [PROPS.status, true],
      [PROPS.priority, true],
      [PROPS.due, true],
      [PROPS.technician, true],
      [PROPS.paid, true],
      [PROPS.notes, true],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Hide all' }));
    expect(sent(actions)?.properties?.filter((s) => s.visible)).toEqual([shown(PROPS.name, 280)]);
    expect(screen.queryByRole('button', { name: 'Hide all' })).toBeNull();
  });

  it('moves a property with the arrow keys and says where it went', () => {
    const { actions } = show();
    const handle = () => screen.getByRole('button', { name: 'Move Cost' });
    handle().focus();
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(sent(actions)).toEqual({
      properties: [
        shown(PROPS.name, 280),
        shown(PROPS.status),
        shown(PROPS.cost, 120),
        off(PROPS.paid),
      ],
    });
    expect(screen.getByText('Moved Cost to 2 of 2.')).toBeInTheDocument();
    expect(handle()).toHaveFocus();
  });

  it('drags a property by its handle', () => {
    const { actions } = show();
    const rows = within(screen.getByRole('list', { name: 'Shown in this view' })).getAllByRole(
      'listitem',
    );
    rows.slice(1).forEach((row, i) => {
      row.getBoundingClientRect = () =>
        ({
          top: i * 40,
          bottom: i * 40 + 40,
          height: 40,
          left: 0,
          right: 200,
          width: 200,
        }) as DOMRect;
    });
    fireEvent(
      screen.getByRole('button', { name: 'Move Status' }),
      new MouseEvent('pointerdown', { bubbles: true, clientY: 60, button: 0 }),
    );
    fireEvent(window, new MouseEvent('pointermove', { clientY: 5 }));
    fireEvent(window, new MouseEvent('pointerup', { clientY: 5 }));
    expect(sent(actions)).toEqual({
      properties: [
        shown(PROPS.name, 280),
        shown(PROPS.status),
        shown(PROPS.cost, 120),
        off(PROPS.paid),
      ],
    });
  });

  it("sets a table column's width and wrap", () => {
    const { actions } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Width and wrap of Cost' }));
    const width = screen.getByRole('textbox', { name: 'Width' });
    expect(width).toHaveValue('120');
    fireEvent.change(width, { target: { value: '20' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a width from 80 to 800.');
    expect(actions.updateView).not.toHaveBeenCalled();
    fireEvent.change(width, { target: { value: '320' } });
    fireEvent.blur(width);
    expect(sent(actions)?.properties?.[1]).toEqual(shown(PROPS.cost, 320));
    fireEvent.click(screen.getByRole('switch', { name: 'Wrap column' }));
    expect(sent(actions)?.properties?.[1]).toEqual({ ...shown(PROPS.cost, 320), wrap: true });
  });

  it('hides Name outside tables with "showTitle", and has no column settings there', () => {
    const { actions } = show({ viewId: VIEWS.board });
    expect(screen.queryByRole('button', { name: /^Width and wrap/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Name' }));
    expect(actions.updateView).toHaveBeenLastCalledWith({ showTitle: false });
    expect(labels('Hidden in this view')[0]).toBe('Show Name');
    fireEvent.click(screen.getByRole('button', { name: 'Show Name' }));
    expect(actions.updateView).toHaveBeenLastCalledWith({ showTitle: true });
  });

  it('searches the properties by name', () => {
    show();
    const search = screen.getByRole('searchbox', { name: 'Search for a property' });
    fireEvent.change(search, { target: { value: 'pa' } });
    expect(screen.queryByRole('list', { name: 'Shown in this view' })).toBeNull();
    expect(labels('Hidden in this view')).toEqual(['Show Paid']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('only lists the properties the viewer can see', () => {
    show({ propertyIds: [PROPS.name, PROPS.status, PROPS.notes] });
    expect(labels('Hidden in this view')).toEqual(['Show Notes']);
  });

  it("is read only for people whose changes aren't saved for everyone", () => {
    show({ canEditViews: false });
    expect(
      screen.getByText('Only people who can edit this view change its properties.'),
    ).toBeInTheDocument();
    expect(labels('Shown in this view')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Deleted' })).toBeNull();
  });

  it('lists the deleted properties and restores one', async () => {
    const meta = jobsDatabase({
      deletedProperties: [
        {
          property: {
            id: 'prop-old-notes',
            name: 'Old notes',
            description: '',
            config: { type: 'text' },
            rowPage: 'always',
          },
          deletedAt: '2026-10-20T16:00:00.000Z',
        },
      ],
    });
    const { client } = show({ meta });
    fireEvent.click(screen.getByRole('button', { name: 'Deleted' }));
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Old notes' }));
    await waitFor(() =>
      expect(client.restoreProperty).toHaveBeenCalledWith(JOBS_ID, 'prop-old-notes'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Deleted' })).toHaveFocus();
  });
});
