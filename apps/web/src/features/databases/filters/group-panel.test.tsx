import { EMPTY_GROUP, type View } from '@carehub/databases';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { jobsDatabase, PRIORITY, PROPS, testViewer, VIEWS } from '../fixtures';
import { mockActions } from '../test-utils';
import { GroupPanel, type GroupPanelProps } from './group-panel';

function show(
  options: {
    viewId?: string;
    change?: Partial<View>;
    canEditViews?: boolean;
    extra?: Partial<GroupPanelProps>;
  } = {},
) {
  const meta = jobsDatabase();
  const base = meta.views.find((v) => v.id === (options.viewId ?? VIEWS.table));
  if (!base) throw new Error('No view');
  const actions = mockActions();
  render(
    <GroupPanel
      meta={meta}
      view={{ ...base, ...options.change }}
      viewer={testViewer()}
      actions={actions}
      canEditViews={options.canEditViews ?? true}
      {...options.extra}
    />,
  );
  return { actions };
}

const sent = (actions: ReturnType<typeof mockActions>) => actions.updateView.mock.lastCall?.[0];
const select = (name: string) => screen.getByRole('combobox', { name });
const pick = (name: string, value: string) => fireEvent.change(select(name), { target: { value } });
const choices = (name: string) =>
  within(select(name))
    .getAllByRole('option')
    .map((o) => o.textContent);
const listed = (name = 'Groups') =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('Group panel', () => {
  it('groups a table by a property, and takes the grouping off with None', () => {
    const { actions } = show();
    expect(choices('Group by')).toEqual([
      'None',
      'Status',
      'Priority',
      'Due date',
      'Technician',
      'Cost',
      'Paid',
      'Notes',
    ]);
    pick('Group by', PROPS.priority);
    expect(sent(actions)).toEqual({ grouping: { propertyId: PROPS.priority } });
    expect(listed()).toEqual(['No value', 'High', 'Medium', 'Low']);
    pick('Group by', '');
    expect(sent(actions)).toEqual({ grouping: null });
    expect(screen.queryByRole('list', { name: 'Groups' })).toBeNull();
  });

  it("sets each type's own setting: dates, status and text", () => {
    const { actions } = show({ change: { grouping: { propertyId: PROPS.due } } });
    expect(select('Group dates by')).toHaveValue('relative');
    expect(choices('Group dates by')).toEqual(['Relative', 'Day', 'Week', 'Month', 'Year']);
    pick('Group dates by', 'month');
    expect(sent(actions)).toEqual({ grouping: { propertyId: PROPS.due, dateBucket: 'month' } });

    pick('Group by', PROPS.status);
    expect(screen.queryByRole('combobox', { name: 'Group dates by' })).toBeNull();
    pick('Group status by', 'group');
    expect(sent(actions)).toEqual({ grouping: { propertyId: PROPS.status, statusBy: 'group' } });
    expect(listed()).toEqual(['No value', 'To-do', 'In progress', 'Complete']);

    pick('Group by', PROPS.notes);
    expect(choices('Group text by')).toEqual(['Exact value', 'First letter']);
    pick('Group text by', 'alphabetical');
    expect(sent(actions)).toEqual({
      grouping: { propertyId: PROPS.notes, textBy: 'alphabetical' },
    });
  });

  it('groups numbers by ranges of a chosen size', () => {
    const { actions } = show({ change: { grouping: { propertyId: PROPS.cost } } });
    pick('Group numbers by', 'ranges');
    expect(sent(actions)).toEqual({
      grouping: { propertyId: PROPS.cost, numberRange: { start: 0, end: 100, step: 10 } },
    });
    const size = screen.getByRole('textbox', { name: 'Size' });
    expect(size).toHaveValue('10');
    fireEvent.change(size, { target: { value: '0' } });
    fireEvent.keyDown(size, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('The size must be above 0.');
    fireEvent.change(size, { target: { value: '25' } });
    fireEvent.blur(size);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sent(actions)).toEqual({
      grouping: { propertyId: PROPS.cost, numberRange: { start: 0, end: 100, step: 25 } },
    });
    const to = screen.getByRole('textbox', { name: 'To' });
    fireEvent.change(to, { target: { value: '-5' } });
    fireEvent.blur(to);
    expect(screen.getByRole('alert')).toHaveTextContent('The end must be above the start.');
    pick('Group numbers by', 'exact');
    expect(sent(actions)).toEqual({ grouping: { propertyId: PROPS.cost, numberRange: null } });
    expect(screen.queryByRole('textbox', { name: 'Size' })).toBeNull();
  });

  it('sorts the groups and hides empty ones', () => {
    const { actions } = show({ change: { grouping: { propertyId: PROPS.priority } } });
    expect(select('Sort groups')).toHaveValue('option');
    expect(choices('Sort groups')).toEqual(['Option order', 'A→Z', 'Z→A', 'By hand']);
    pick('Sort groups', 'desc');
    expect(sent(actions)).toEqual({ grouping: { propertyId: PROPS.priority, sort: 'desc' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Hide empty groups' }));
    expect(sent(actions)).toEqual({
      grouping: { propertyId: PROPS.priority, sort: 'desc', hideEmpty: true },
    });
  });

  it('hides and shows groups, one or all', () => {
    const { actions } = show({ change: { grouping: { propertyId: PROPS.priority } } });
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Low' }));
    expect(sent(actions)).toEqual({
      grouping: { propertyId: PROPS.priority, hidden: [PRIORITY.low] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(sent(actions)).toEqual({ grouping: { propertyId: PROPS.priority } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide all' }));
    expect(sent(actions)?.grouping?.hidden).toEqual([
      EMPTY_GROUP,
      PRIORITY.high,
      PRIORITY.medium,
      PRIORITY.low,
    ]);
    expect(screen.getByRole('button', { name: 'Show No value' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide all' })).toBeNull();
  });

  it('orders the groups by hand with the arrow keys and says where one went', () => {
    const { actions } = show({ change: { grouping: { propertyId: PROPS.priority } } });
    const handle = () => screen.getByRole('button', { name: 'Move High' });
    handle().focus();
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(sent(actions)).toEqual({
      grouping: {
        propertyId: PROPS.priority,
        sort: 'manual',
        order: [EMPTY_GROUP, PRIORITY.medium, PRIORITY.high, PRIORITY.low],
      },
    });
    expect(screen.getByText('Moved High to 3 of 4.')).toBeInTheDocument();
    expect(listed()).toEqual(['No value', 'Medium', 'High', 'Low']);
    expect(handle()).toHaveFocus();
    expect(select('Sort groups')).toHaveValue('manual');
  });

  it('keeps a board grouped and splits it into sub-groups', () => {
    const { actions } = show({ viewId: VIEWS.board });
    expect(choices('Group by')).not.toContain('None');
    expect(choices('Sub-group by')).toEqual([
      'None',
      'Priority',
      'Due date',
      'Technician',
      'Cost',
      'Paid',
      'Notes',
    ]);
    pick('Sub-group by', PROPS.priority);
    expect(sent(actions)).toEqual({ subGrouping: { propertyId: PROPS.priority } });
    expect(listed('Sub-groups')).toEqual(['No value', 'High', 'Medium', 'Low']);
    pick('Group by', PROPS.priority);
    expect(sent(actions)).toEqual({ grouping: { propertyId: PROPS.priority }, subGrouping: null });
    expect(select('Sub-group by')).toHaveValue('');
  });

  it('leaves sub-groups to people who can edit the view', () => {
    const { actions } = show({ viewId: VIEWS.board, canEditViews: false });
    expect(screen.queryByRole('combobox', { name: 'Sub-group by' })).toBeNull();
    pick('Group by', PROPS.paid);
    expect(sent(actions)).toEqual({ grouping: { propertyId: PROPS.paid } });
    expect(listed()).toEqual(['Unchecked', 'Checked']);
  });

  it("names the groups from the view's answer, and offers only what the viewer can see", () => {
    show({
      change: { grouping: { propertyId: PROPS.technician } },
      extra: {
        propertyIds: [PROPS.name, PROPS.technician, PROPS.paid],
        groups: [
          {
            key: 'user-avery',
            label: 'Avery Lin',
            collapsedKey: `${PROPS.technician}:value:user-avery`,
          },
          {
            key: EMPTY_GROUP,
            label: 'No value',
            collapsedKey: `${PROPS.technician}:value:${EMPTY_GROUP}`,
          },
        ],
      },
    });
    expect(choices('Group by')).toEqual(['None', 'Technician', 'Paid']);
    expect(listed()).toEqual(['Avery Lin', 'No value']);
  });

  it("says when a layout doesn't group rows", () => {
    show({ change: { layout: 'calendar' } });
    expect(screen.getByText("This layout doesn't group rows.")).toBeInTheDocument();
  });

  it('names a grouping property that was deleted', () => {
    show({ change: { grouping: { propertyId: 'prop-gone' } } });
    expect(select('Group by')).toHaveValue('prop-gone');
    expect(choices('Group by')[1]).toBe('This property was deleted.');
    expect(screen.queryByRole('combobox', { name: 'Sort groups' })).toBeNull();
  });
});
