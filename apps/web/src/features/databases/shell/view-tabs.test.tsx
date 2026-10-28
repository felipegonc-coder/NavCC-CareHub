import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { View } from '@carehub/databases';
import { defaultView } from '@carehub/databases/schema';
import { ApiError, type DatabaseWithVersion } from '../api';
import {
  JOBS_ID,
  jobsDatabase,
  jobsProperties,
  jobsViews,
  mockClient,
  renderWithDatabase,
  testViewer,
  VIEWS,
  type MockClient,
} from '../test-utils';
import { DatabaseView, type DatabaseViewProps } from './database-view';
import { probe } from './test-layout';
import { TAB_DRAG_TYPE } from './view-tabs';

vi.mock('../layouts', async () => {
  const { probeLayouts } = await import('./test-layout');
  return { LAYOUTS: probeLayouts() };
});

const viewer = testViewer();

/**
 * A client whose database changes with each settings write, as the server's would: new views and
 * copies are added, the order and names are saved, and GET /:id answers the latest.
 */
function savingClient(start: DatabaseWithVersion = jobsDatabase()) {
  const client = mockClient();
  let meta = start;
  const save = (views: View[]) => {
    meta = { ...meta, views, version: meta.version + 1 };
    return meta;
  };
  client.getDatabase.mockImplementation(async () => meta);
  client.createView.mockImplementation(async (_databaseId, { layout, name }) => {
    const view = { ...defaultView(layout, meta.properties, { name }), id: 'view-new' };
    return { ...save([...meta.views, view]), viewId: view.id };
  });
  client.duplicateView.mockImplementation(async (_databaseId, viewId) => {
    const from = meta.views.find((v) => v.id === viewId);
    if (!from) throw new ApiError(404, 'not_found', 'Not found.');
    const copy = { ...from, id: 'view-copy', name: `${from.name} copy` };
    return { ...save([...meta.views, copy]), viewId: copy.id };
  });
  client.updateView.mockImplementation(async (_databaseId, viewId, change) =>
    save(meta.views.map((v) => (v.id === viewId ? { ...v, ...change } : v))),
  );
  client.orderViews.mockImplementation(async (_databaseId, viewIds) =>
    save(viewIds.flatMap((id) => meta.views.filter((v) => v.id === id))),
  );
  client.deleteView.mockImplementation(async (_databaseId, viewId) =>
    save(meta.views.filter((v) => v.id !== viewId)),
  );
  return client;
}

async function shown(client: MockClient = savingClient(), props: Partial<DatabaseViewProps> = {}) {
  const rendered = renderWithDatabase(
    <DatabaseView databaseId={JOBS_ID} viewer={viewer} {...props} />,
    { client },
  );
  await screen.findByTestId('probe-layout');
  return { ...rendered, client };
}

/** Radix menus open on Enter. */
async function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
  return screen.findByRole('menu');
}

async function choose(menuButton: string, item: string) {
  const menu = await openMenu(menuButton);
  fireEvent.click(within(menu).getByRole('menuitem', { name: item }));
}

function tabNames(): string[] {
  const list = screen.getByRole('tablist', { name: 'Views' });
  return within(list)
    .getAllByRole('tab')
    .map((tab) => tab.textContent ?? '');
}

beforeEach(() => {
  probe.props = null;
  localStorage.clear();
});

describe('view tabs', () => {
  it('adds a view named after the layout picked with "+", and shows it', async () => {
    const { client } = await shown();
    const menu = await openMenu('Add view');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Table',
      'Board',
      'List',
      'Gallery',
      'Calendar',
      'Timeline',
      'Chart',
      'Form',
      'Feed',
      'Dashboard',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Board' }));
    expect(await screen.findByRole('tab', { name: 'Board', selected: true })).toBeInTheDocument();
    expect(client.createView).toHaveBeenCalledWith(JOBS_ID, { layout: 'board', name: 'Board' });
    await waitFor(() => expect(probe.props?.view.id).toBe('view-new'));
  });

  it('numbers a new name that is taken', async () => {
    const views = [...jobsViews(), { ...jobsViews()[0]!, id: 'view-table', name: 'Table' }];
    const { client } = await shown(savingClient(jobsDatabase({ views })));
    await choose('Add view', 'Table');
    await waitFor(() =>
      expect(client.createView).toHaveBeenCalledWith(JOBS_ID, { layout: 'table', name: 'Table 2' }),
    );
  });

  it('duplicates the view showing and shows the copy', async () => {
    const { client } = await shown();
    await choose('More actions for All jobs', 'Duplicate');
    expect(
      await screen.findByRole('tab', { name: 'All jobs copy', selected: true }),
    ).toBeInTheDocument();
    expect(client.duplicateView).toHaveBeenCalledWith(JOBS_ID, VIEWS.table);
  });

  it('renames the view from its "…"; Esc keeps the old name', async () => {
    const { client } = await shown();
    await choose('More actions for All jobs', 'Rename');
    const box = await screen.findByRole('textbox', { name: 'View name' });
    expect(box).toHaveValue('All jobs');
    fireEvent.change(box, { target: { value: 'Open jobs' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'View name' })).toBeNull());
    expect(client.updateView).not.toHaveBeenCalled();

    await choose('More actions for All jobs', 'Rename');
    const again = await screen.findByRole('textbox', { name: 'View name' });
    fireEvent.change(again, { target: { value: '  Open jobs ' } });
    const form = again.closest('form');
    if (!form) throw new Error('The name box has no form.');
    fireEvent.submit(form);
    expect(await screen.findByRole('tab', { name: 'Open jobs' })).toBeInTheDocument();
    expect(client.updateView).toHaveBeenCalledWith(JOBS_ID, VIEWS.table, { name: 'Open jobs' });
  });

  it('moves the view showing left or right, and shows the new order at once', async () => {
    const { client } = await shown();
    const menu = await openMenu('More actions for All jobs');
    expect(within(menu).getByRole('menuitem', { name: 'Move left' })).toHaveAttribute(
      'data-disabled',
    );
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move right' }));
    await waitFor(() => expect(tabNames()).toEqual(['By status', 'All jobs']));
    await waitFor(() =>
      expect(client.orderViews).toHaveBeenCalledWith(JOBS_ID, [VIEWS.board, VIEWS.table]),
    );
  });

  it('reorders tabs dragged onto another', async () => {
    const { client } = await shown();
    const dataTransfer = { setData: vi.fn(), effectAllowed: 'all' };
    const board = screen.getByRole('tab', { name: 'By status' });
    const table = screen.getByRole('tab', { name: 'All jobs' });
    fireEvent.dragStart(board, { dataTransfer });
    fireEvent.dragOver(table, { dataTransfer });
    // The pointer is on the left half of "All jobs" (jsdom has no sizes), so it lands before it.
    fireEvent.drop(table, { dataTransfer });
    await waitFor(() => expect(tabNames()).toEqual(['By status', 'All jobs']));
    await waitFor(() =>
      expect(client.orderViews).toHaveBeenCalledWith(JOBS_ID, [VIEWS.board, VIEWS.table]),
    );
    // Only the view's id, no text, which the page around a database block would paste.
    expect(dataTransfer.setData.mock.calls).toEqual([[TAB_DRAG_TYPE, VIEWS.board]]);
  });

  it('hides a deleted view at once with Undo, and Undo brings it back', async () => {
    const { client } = await shown();
    await choose('More actions for All jobs', 'Delete');
    expect(screen.queryByRole('tab', { name: 'All jobs' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'By status', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('View deleted.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      await screen.findByRole('tab', { name: 'All jobs', selected: true }),
    ).toBeInTheDocument();
    expect(client.deleteView).not.toHaveBeenCalled();
  });

  it('deletes the view once Undo is gone', async () => {
    const { client, unmount } = await shown();
    await choose('More actions for All jobs', 'Delete');
    expect(client.deleteView).not.toHaveBeenCalled();
    // Leaving the screen ends the chance to undo.
    unmount();
    await waitFor(() => expect(client.deleteView).toHaveBeenCalledWith(JOBS_ID, VIEWS.table));
  });

  it('deletes when another toast replaces Undo, and says why it was refused', async () => {
    const week = {
      ...defaultView('list', jobsProperties(), { name: 'This week' }),
      id: 'view-week',
    };
    const client = savingClient(jobsDatabase({ views: [...jobsViews(), week] }));
    const refusal = new ApiError(403, 'forbidden', 'You can’t change views.');
    client.deleteView.mockRejectedValue(refusal);
    await shown(client);
    await choose('More actions for All jobs', 'Delete');
    await choose('More actions for By status', 'Delete');
    await waitFor(() => expect(client.deleteView).toHaveBeenCalledWith(JOBS_ID, VIEWS.table));
    expect(await screen.findByRole('tab', { name: 'All jobs' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('You can’t change views.'),
    );
  });

  it("can't delete the last view", async () => {
    const client = savingClient(jobsDatabase({ views: [jobsViews()[0]!] }));
    await shown(client);
    const menu = await openMenu('More actions for All jobs');
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('data-disabled');
  });

  it('offers no "+" or Duplicate once the database has 100 views', async () => {
    const views = Array.from({ length: 100 }, (_, i) => ({
      ...jobsViews()[0]!,
      id: `view-${i + 1}`,
      name: `View ${i + 1}`,
    }));
    await shown(savingClient(jobsDatabase({ views })));
    expect(screen.queryByRole('button', { name: 'Add view' })).toBeNull();
    const menu = await openMenu('More actions for View 1');
    expect(within(menu).queryByRole('menuitem', { name: 'Duplicate' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  });

  it('shows no "+" or "…" to someone who can only view', async () => {
    await shown(savingClient(jobsDatabase({ viewerAccess: 'view' })));
    expect(screen.getByRole('tab', { name: 'All jobs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add view' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions for All jobs' })).toBeNull();
  });

  it('switches views from the dropdown (phones, or a block whose view asks for it)', async () => {
    const views = jobsViews().map((v) => ({ ...v, tabsAs: 'dropdown' as const }));
    const onViewChange = vi.fn();
    await shown(savingClient(jobsDatabase({ views })), { inline: true, onViewChange });
    const menu = await openMenu('Views: All jobs');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'By status' }));
    await waitFor(() => expect(probe.props?.view.id).toBe(VIEWS.board));
    expect(onViewChange).toHaveBeenCalledWith(VIEWS.board);
    expect(await screen.findByRole('button', { name: 'Views: By status' })).toBeInTheDocument();
  });
});
