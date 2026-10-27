import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterGroup, View } from '@carehub/databases';
import { ApiError, UNKNOWN_ERROR_MESSAGE } from '../api';
import type { LayoutProps } from '../contract';
import {
  JOBS_ID,
  jobsDatabase,
  mockClient,
  PROPS,
  queryData,
  renderWithDatabase,
  STATUS,
  testViewer,
  VIEWS,
} from '../test-utils';
import { DatabaseView, type DatabaseViewProps } from './database-view';
import { BROKEN_VIEW, probe } from './test-layout';
import { lastViewKey } from './view-state';

vi.mock('../layouts', async () => {
  const { probeLayouts } = await import('./test-layout');
  return { LAYOUTS: probeLayouts() };
});

const viewer = testViewer();
const byDue = [{ propertyId: PROPS.due, direction: 'asc' as const }];
const paidOnly: FilterGroup = {
  kind: 'group',
  id: 'filter-root',
  combinator: 'and',
  children: [{ kind: 'condition', id: 'filter-paid', propertyId: PROPS.paid, op: 'is_checked' }],
};

function show(props: Partial<DatabaseViewProps> = {}, client = mockClient()) {
  return renderWithDatabase(<DatabaseView databaseId={JOBS_ID} viewer={viewer} {...props} />, {
    client,
  });
}

/** What the layout was handed last. */
function drawn(): LayoutProps {
  if (!probe.props) throw new Error('The layout has not drawn yet.');
  return probe.props;
}

/** The block a state's text is in, with its buttons. */
function around(text: string): HTMLElement {
  const block = screen.getByText(text).parentElement;
  if (!block) throw new Error(`Nothing around "${text}".`);
  return block;
}

function changeTable(change: Partial<View>): View[] {
  return jobsDatabase().views.map((v) => (v.id === VIEWS.table ? { ...v, ...change } : v));
}

beforeEach(() => {
  probe.props = null;
  localStorage.clear();
});

describe('DatabaseView', () => {
  it('shows the title, description, view tabs and the rows of the first view', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByText('Every job Blue Pine Plumbing has booked.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All jobs', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'By status', selected: false })).toBeInTheDocument();
    const layout = await screen.findByTestId('probe-layout');
    expect(within(layout).getByText('Fix kitchen sink leak')).toBeInTheDocument();
    expect(screen.getByTestId('database')).toHaveAttribute('data-database-id', JOBS_ID);
    expect(drawn().view.id).toBe(VIEWS.table);
    expect(drawn().readOnly).toBe(false);
  });

  it('opens the view the link names, and remembers it', async () => {
    show({ viewId: VIEWS.board });
    expect(
      await screen.findByRole('tab', { name: 'By status', selected: true }),
    ).toBeInTheDocument();
    await screen.findByTestId('probe-layout');
    expect(drawn().view.id).toBe(VIEWS.board);
    expect(localStorage.getItem(lastViewKey(JOBS_ID))).toBe(VIEWS.board);
  });

  it('opens the view used last when the link names none', async () => {
    localStorage.setItem(lastViewKey(JOBS_ID), VIEWS.board);
    show();
    expect(
      await screen.findByRole('tab', { name: 'By status', selected: true }),
    ).toBeInTheDocument();
  });

  it('switches views from the tabs and tells the link', async () => {
    const onViewChange = vi.fn();
    show({ onViewChange });
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'By status' }));
    expect(onViewChange).toHaveBeenCalledWith(VIEWS.board);
    expect(screen.getByRole('tab', { name: 'By status', selected: true })).toBeInTheDocument();
    await waitFor(() => expect(drawn().view.id).toBe(VIEWS.board));
    await waitFor(() =>
      expect(drawn().data.groups?.map((g) => g.label)).toEqual([
        'Not started',
        'In progress',
        'Done',
      ]),
    );
  });

  it('shows "No rows yet." with New and Import CSV; New opens the new row', async () => {
    const client = mockClient();
    client.query.mockResolvedValue(queryData([]));
    const onOpenRow = vi.fn();
    const onImportCsv = vi.fn();
    show({ onOpenRow, onImportCsv }, client);
    await screen.findByText('No rows yet.');
    const empty = around('No rows yet.');
    fireEvent.click(within(empty).getByRole('button', { name: 'Import CSV' }));
    expect(onImportCsv).toHaveBeenCalledTimes(1);
    fireEvent.click(within(empty).getByRole('button', { name: 'New' }));
    await waitFor(() => expect(onOpenRow).toHaveBeenCalledWith('row-new', 'side_peek'));
    expect(client.createRow).toHaveBeenCalledWith(
      JOBS_ID,
      expect.objectContaining({ viewId: VIEWS.table }),
    );
  });

  it('offers New but not Import CSV to someone who can edit content only', async () => {
    const client = mockClient();
    client.getDatabase.mockResolvedValue(jobsDatabase({ viewerAccess: 'edit_content' }));
    client.query.mockResolvedValue(queryData([]));
    show({ onImportCsv: vi.fn() }, client);
    await screen.findByText('No rows yet.');
    expect(within(around('No rows yet.')).getByRole('button', { name: 'New' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import CSV' })).toBeNull();
  });

  it('shows "No rows match." when the filter leaves none; Clear filters saves the view', async () => {
    const client = mockClient();
    client.getDatabase.mockResolvedValue(
      jobsDatabase({ views: changeTable({ filter: paidOnly }) }),
    );
    client.query.mockResolvedValue(queryData([]));
    show({}, client);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(client.updateView).toHaveBeenCalledWith(JOBS_ID, VIEWS.table, { filter: null }),
    );
    expect(screen.queryByText('Changed for you only')).toBeNull();
  });

  it('clears the filter for this person only when they cannot edit the view', async () => {
    const client = mockClient();
    client.getDatabase.mockResolvedValue(
      jobsDatabase({ viewerAccess: 'edit_content', views: changeTable({ filter: paidOnly }) }),
    );
    client.query.mockResolvedValue(queryData([]));
    show({}, client);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Changed for you only')).toBeInTheDocument();
    await waitFor(() =>
      expect(client.query).toHaveBeenLastCalledWith(JOBS_ID, {
        viewId: VIEWS.table,
        override: { filter: null },
        search: '',
      }),
    );
    expect(client.updateView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.queryByText('Changed for you only')).toBeNull());
    expect(await screen.findByText('No rows match.')).toBeInTheDocument();
  });

  it("keeps sorts as the viewer's own when they can only view, until Reset", async () => {
    const client = mockClient();
    client.getDatabase.mockResolvedValue(jobsDatabase({ viewerAccess: 'view' }));
    show({}, client);
    await screen.findByTestId('probe-layout');
    expect(drawn().readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();

    await act(() => drawn().actions.updateView({ sorts: byDue, name: 'Mine' }));
    expect(await screen.findByText('Changed for you only')).toBeInTheDocument();
    await waitFor(() => expect(drawn().view.sorts).toEqual(byDue));
    expect(drawn().view.name).toBe('All jobs');
    expect(client.updateView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(drawn().view.sorts).toEqual([]));
    expect(screen.queryByText('Changed for you only')).toBeNull();
  });

  it("says there's no access, without the title", async () => {
    const client = mockClient();
    client.getDatabase.mockRejectedValue(
      new ApiError(403, 'forbidden', "You don't have access to this."),
    );
    show({}, client);
    expect(await screen.findByText("You don't have access to this database.")).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByText('Jobs')).toBeNull();
  });

  it('shows why rows failed to load, inside the block, with Retry', async () => {
    const client = mockClient();
    client.query.mockRejectedValueOnce(
      new ApiError(500, 'server_error', 'Care Hub is busy. Try again in a minute.'),
    );
    show({}, client);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Care Hub is busy. Try again in a minute.',
    );
    expect(screen.getByRole('heading', { name: 'Jobs' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Fix kitchen sink leak')).toBeInTheDocument();
  });

  it('shows the reason instead of rows when the view uses a hidden property', async () => {
    const client = mockClient();
    client.query.mockResolvedValue({ blocked: "This view uses a property you can't see." });
    show({}, client);
    expect(await screen.findByText("This view uses a property you can't see.")).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'By status' })).toBeInTheDocument();
  });

  it('shows grey rows while a slow view loads', async () => {
    const client = mockClient();
    client.query.mockReturnValue(new Promise<never>(() => undefined));
    show({}, client);
    expect((await screen.findByTestId('database-loading')).children).toHaveLength(6);
  });

  it('keeps a broken layout inside the block', async () => {
    const client = mockClient();
    client.getDatabase.mockResolvedValue(
      jobsDatabase({ views: changeTable({ name: BROKEN_VIEW }) }),
    );
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      show({}, client);
      expect(await screen.findByRole('alert')).toHaveTextContent(UNKNOWN_ERROR_MESSAGE);
      expect(screen.getByRole('heading', { name: 'Jobs' })).toBeInTheDocument();
    } finally {
      quiet.mockRestore();
    }
  });
});

describe('DatabaseView actions', () => {
  it('moves rows to Trash with Undo', async () => {
    const client = mockClient();
    show({}, client);
    await screen.findByTestId('probe-layout');
    await act(() => drawn().actions.trashRows(['row-sink']));
    expect(client.trashRows).toHaveBeenCalledWith(JOBS_ID, ['row-sink']);
    expect(screen.getByRole('status')).toHaveTextContent('Moved to Trash.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(client.restoreRows).toHaveBeenCalledWith(JOBS_ID, ['row-sink']));
  });

  it("writes the column's value when a card moves on a board, then its place", async () => {
    const client = mockClient();
    show({ viewId: VIEWS.board }, client);
    await waitFor(() => expect(drawn().data.groups).not.toBeNull());
    await act(() =>
      drawn().actions.moveRow('row-heater', {
        fromGroupKey: STATUS.notStarted,
        toGroupKey: STATUS.done,
        beforeRowId: 'row-boiler',
      }),
    );
    expect(client.updateRow).toHaveBeenCalledWith(JOBS_ID, 'row-heater', {
      [PROPS.status]: STATUS.done,
    });
    expect(client.moveRow).toHaveBeenCalledWith(JOBS_ID, VIEWS.board, 'row-heater', 'row-boiler');
  });

  it('rolls a refused change back and says why', async () => {
    const client = mockClient();
    client.updateRow.mockRejectedValueOnce(
      new ApiError(409, 'conflict', 'Someone else changed this row. Try again.'),
    );
    show({}, client);
    await screen.findByTestId('probe-layout');
    await act(async () => {
      await expect(
        drawn().actions.updateValues('row-sink', { [PROPS.paid]: true }),
      ).rejects.toMatchObject({ code: 'conflict' });
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Someone else changed this row. Try again.',
    );
    await waitFor(() =>
      expect(drawn().data.rows.find((r) => r.id === 'row-sink')?.values[PROPS.paid]).toBe(false),
    );
  });

  it('makes new rows with the default template of the view', async () => {
    const client = mockClient();
    const template = { id: 'template-visit', name: 'Site visit', icon: null, values: {} };
    client.getDatabase.mockResolvedValue(
      jobsDatabase({ templates: [template], defaultTemplateId: template.id }),
    );
    show({}, client);
    await screen.findByTestId('probe-layout');
    await act(() => drawn().actions.createRow({ title: 'Check the pump' }));
    expect(client.createRow).toHaveBeenCalledWith(
      JOBS_ID,
      expect.objectContaining({
        title: 'Check the pump',
        templateId: 'template-visit',
        viewId: VIEWS.table,
      }),
    );
    await act(() => drawn().actions.createRow({ templateId: null }));
    expect(client.createRow).toHaveBeenLastCalledWith(
      JOBS_ID,
      expect.objectContaining({ templateId: undefined }),
    );
  });
});
