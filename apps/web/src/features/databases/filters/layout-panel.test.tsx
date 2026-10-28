import {
  defaultView,
  type ColorRule,
  type Property,
  type TimelineOptions,
  type View,
  type ViewLayout,
} from '@carehub/databases';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { jobsDatabase, jobsProperties, PROPS, STATUS, testViewer, VIEWS } from '../fixtures';
import { mockActions } from '../test-utils';
import { LayoutPanel } from './layout-panel';

const extra = (id: string, name: string, config: Property['config']): Property => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});
const photos = extra('prop-photos', 'Photos', { type: 'files' });
const finished = extra('prop-finished', 'Finished', {
  type: 'date',
  format: 'full',
  timeFormat: 'viewer',
});

function show(
  options: {
    layout?: ViewLayout;
    viewId?: string;
    meta?: Parameters<typeof jobsDatabase>[0];
    canEditViews?: boolean;
    propertyIds?: string[];
    colorRules?: ColorRule[];
  } = {},
) {
  const meta = jobsDatabase(options.meta);
  const found: View | undefined = options.layout
    ? { ...defaultView(options.layout, meta.properties), id: 'view-other' }
    : meta.views.find((v) => v.id === (options.viewId ?? VIEWS.table));
  if (!found) throw new Error('No view');
  const view = options.colorRules ? { ...found, colorRules: options.colorRules } : found;
  const actions = mockActions();
  render(
    <LayoutPanel
      meta={meta}
      view={view}
      viewer={testViewer()}
      actions={actions}
      canEditViews={options.canEditViews ?? true}
      propertyIds={options.propertyIds}
    />,
  );
  return actions;
}

const select = (name: string) => screen.getByRole('combobox', { name });
const toggle = (name: string) => screen.getByRole('switch', { name });
const choices = (name: string) =>
  within(select(name))
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('Layout panel', () => {
  it('offers a table its settings and sends each change as one patch', () => {
    const actions = show();
    expect(choices('Open rows in')).toEqual(['Side panel', 'Centered window', 'Full page']);
    fireEvent.change(select('Open rows in'), { target: { value: 'center_peek' } });
    expect(actions.updateView).toHaveBeenLastCalledWith({ openPagesIn: 'center_peek' });
    expect(choices('Load limit')).toEqual([
      '10 rows',
      '25 rows',
      '50 rows',
      '100 rows',
      '200 rows',
    ]);
    expect(select('Load limit')).toHaveValue('50');
    fireEvent.change(select('Load limit'), { target: { value: '100' } });
    expect(actions.updateView).toHaveBeenLastCalledWith({ loadLimit: 100 });
    fireEvent.click(toggle('Show page icons'));
    expect(actions.updateView).toHaveBeenLastCalledWith({ showPageIcon: false });
    fireEvent.click(toggle('Wrap cells'));
    expect(actions.updateView).toHaveBeenLastCalledWith({
      table: { frozenUpTo: null, wrapCells: true, showVerticalLines: true },
    });
    // Builds on the change before, without waiting for the saved view.
    fireEvent.click(toggle('Show vertical lines'));
    expect(actions.updateView).toHaveBeenLastCalledWith({
      table: { frozenUpTo: null, wrapCells: true, showVerticalLines: false },
    });
    expect(actions.updateView).toHaveBeenCalledTimes(5);
    expect(screen.queryByRole('switch', { name: 'Wrap text' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Show views as' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Sub-items' })).toBeNull();
  });

  it("offers a board's cards, with each Files property as a preview", () => {
    const actions = show({
      viewId: VIEWS.board,
      meta: { properties: [...jobsProperties(), photos] },
    });
    expect(choices('Load limit')[2]).toBe('50 cards per group');
    expect(choices('Card preview')).toEqual(['None', 'Page cover', 'Page content', 'Photos']);
    fireEvent.change(select('Card preview'), { target: { value: 'files:prop-photos' } });
    const board = {
      cardPreview: { kind: 'files', propertyId: photos.id },
      cardSize: 'm',
      fitImage: false,
      colorColumns: true,
    };
    expect(actions.updateView).toHaveBeenLastCalledWith({ board });
    fireEvent.change(select('Card size'), { target: { value: 'l' } });
    expect(actions.updateView).toHaveBeenLastCalledWith({ board: { ...board, cardSize: 'l' } });
    fireEvent.click(toggle('Fit image'));
    fireEvent.click(toggle('Color columns'));
    expect(actions.updateView).toHaveBeenLastCalledWith({
      board: { ...board, cardSize: 'l', fitImage: true, colorColumns: false },
    });
    fireEvent.click(toggle('Wrap text'));
    expect(actions.updateView).toHaveBeenLastCalledWith({ wrapText: true });
  });

  it('only offers the Files properties the viewer can see', () => {
    show({
      viewId: VIEWS.board,
      meta: { properties: [...jobsProperties(), photos] },
      propertyIds: jobsProperties().map((p) => p.id),
    });
    expect(choices('Card preview')).toEqual(['None', 'Page cover', 'Page content']);
  });

  it("offers a gallery's cards without column colors", () => {
    const actions = show({ layout: 'gallery' });
    expect(select('Card preview')).toHaveValue('cover');
    fireEvent.change(select('Card size'), { target: { value: 's' } });
    expect(actions.updateView).toHaveBeenLastCalledWith({
      gallery: { cardPreview: { kind: 'cover' }, cardSize: 's', fitImage: false },
    });
    expect(screen.queryByRole('switch', { name: 'Color columns' })).toBeNull();
  });

  it('shows a calendar by a date and hides weekends', () => {
    const actions = show({ layout: 'calendar' });
    expect(choices('Show by')).toEqual(['Due date']);
    fireEvent.click(toggle('Show weekends'));
    expect(actions.updateView).toHaveBeenLastCalledWith({
      calendar: { showBy: PROPS.due, mode: 'month', showWeekends: false },
    });
    expect(screen.queryByRole('combobox', { name: 'Load limit' })).toBeNull();
  });

  it('says so when there is no date to show a calendar by', () => {
    show({
      layout: 'calendar',
      meta: { properties: jobsProperties().filter((p) => p.config.type !== 'date') },
    });
    expect(choices('Show by')).toEqual(['No date property']);
  });

  it("sets a timeline's end date, table and weekends", () => {
    const actions = show({
      layout: 'timeline',
      meta: { properties: [...jobsProperties(), finished] },
    });
    expect(choices('Show by')).toEqual(['Due date', 'Finished']);
    expect(choices('End date')).toEqual(['Same as Show by', 'Finished']);
    const timeline: TimelineOptions = {
      showBy: PROPS.due,
      endBy: null,
      scale: 'week',
      showTable: true,
      tableProperties: [],
    };
    fireEvent.change(select('End date'), { target: { value: finished.id } });
    expect(actions.updateView).toHaveBeenLastCalledWith({
      timeline: { ...timeline, endBy: finished.id },
    });
    fireEvent.click(toggle('Show table'));
    fireEvent.click(toggle('Show weekends'));
    expect(actions.updateView).toHaveBeenLastCalledWith({
      timeline: { ...timeline, endBy: finished.id, showTable: false, showWeekends: false },
    });
    expect(screen.queryByRole('switch', { name: 'Show dependencies' })).toBeNull();
  });

  it('draws dependency arrows on a timeline once dependencies are on', () => {
    const actions = show({
      layout: 'timeline',
      meta: {
        dependencies: {
          blockedByPropertyId: 'prop-blocked-by',
          blockingPropertyId: 'prop-blocking',
          shift: 'shift',
        },
      },
    });
    expect(toggle('Show dependencies')).toBeChecked();
    fireEvent.click(toggle('Show dependencies'));
    expect(actions.updateView).toHaveBeenLastCalledWith({
      timeline: expect.objectContaining({ showDependencies: false }),
    });
  });

  it('shows sub-items nested, flattened or parents only', () => {
    const actions = show({
      meta: { subItems: { parentPropertyId: 'prop-parent', childrenPropertyId: 'prop-children' } },
    });
    expect(choices('Sub-items')).toEqual(['Nested', 'Flattened', 'Parents only']);
    expect(select('Sub-items')).toHaveValue('nested');
    fireEvent.click(toggle('Filter sub-items too'));
    expect(actions.updateView).toHaveBeenLastCalledWith({ filterSubItems: true });
    fireEvent.change(select('Sub-items'), { target: { value: 'flattened' } });
    expect(actions.updateView).toHaveBeenLastCalledWith({ subItems: 'flattened' });
    expect(screen.queryByRole('switch', { name: 'Filter sub-items too' })).toBeNull();
  });

  it("shows a database block's views as tabs or a dropdown", () => {
    const actions = show({ meta: { inline: true } });
    expect(choices('Show views as')).toEqual(['Tabs', 'Dropdown']);
    fireEvent.change(select('Show views as'), { target: { value: 'dropdown' } });
    expect(actions.updateView).toHaveBeenLastCalledWith({ tabsAs: 'dropdown' });
  });

  it("is read only for people whose changes aren't saved for everyone", () => {
    show({ canEditViews: false });
    expect(
      screen.getByText('Only people who can edit this view change its layout.'),
    ).toBeInTheDocument();
    expect(select('Open rows in')).toBeDisabled();
    expect(toggle('Show page icons')).toBeDisabled();
  });

  it('says when a layout has no settings here', () => {
    show({ layout: 'form' });
    expect(screen.getByText('This layout has no settings here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conditional color' })).toBeNull();
  });

  it('opens conditional color and comes back to its button', () => {
    const done: ColorRule = {
      id: 'rule-done',
      filter: {
        kind: 'group',
        id: 'g-done',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            id: 'c-done',
            propertyId: PROPS.status,
            op: 'is',
            value: [STATUS.done],
          },
        ],
      },
      target: { kind: 'row' },
      color: 'green',
    };
    show({ colorRules: [done, { ...done, id: 'rule-again' }] });
    const open = screen.getByRole('button', { name: 'Conditional color' });
    expect(open).toHaveAccessibleDescription('2 rules');
    fireEvent.click(open);
    expect(screen.getByRole('heading', { name: 'Conditional color' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Open rows in' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Conditional color' })).toHaveFocus();
    expect(select('Open rows in')).toBeInTheDocument();
  });

  it("lists the color rules for people who can't change them", () => {
    show({ canEditViews: false });
    const open = screen.getByRole('button', { name: 'Conditional color' });
    expect(open).toBeEnabled();
    fireEvent.click(open);
    expect(screen.getByText('No color rules yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add color rule' })).toBeNull();
  });

  it.each(['list', 'board', 'gallery', 'calendar', 'timeline'] as const)(
    'offers conditional color on a %s',
    (layout) => {
      show({ layout });
      expect(screen.getByRole('button', { name: 'Conditional color' })).toBeInTheDocument();
    },
  );

  it('puts a setting back when the save is refused', async () => {
    const meta = jobsDatabase();
    const [view] = meta.views;
    if (!view) throw new Error('No view');
    const actions = mockActions();
    actions.updateView.mockRejectedValueOnce(new Error('Refused'));
    render(
      <LayoutPanel meta={meta} view={view} viewer={testViewer()} actions={actions} canEditViews />,
    );
    fireEvent.click(toggle('Show page icons'));
    expect(toggle('Show page icons')).not.toBeChecked();
    await waitFor(() => expect(toggle('Show page icons')).toBeChecked());
  });
});
