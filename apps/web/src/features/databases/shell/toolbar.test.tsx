import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError } from '../api';
import {
  JOBS_ID,
  jobsDatabase,
  mockClient,
  PROPS,
  queryData,
  renderWithDatabase,
  testViewer,
  VIEWS,
} from '../test-utils';
import { DatabaseView, type DatabaseViewProps } from './database-view';
import { panelProbe } from './test-layout';

vi.mock('../layouts', async () => {
  const { probeLayouts } = await import('./test-layout');
  return { LAYOUTS: probeLayouts() };
});

vi.mock('../panels', async () => {
  const { probePanels } = await import('./test-layout');
  return { PANELS: probePanels() };
});

const viewer = testViewer();

function show(props: Partial<DatabaseViewProps> = {}, client = mockClient()) {
  return renderWithDatabase(<DatabaseView databaseId={JOBS_ID} viewer={viewer} {...props} />, {
    client,
  });
}

async function shown(props: Partial<DatabaseViewProps> = {}, client = mockClient()) {
  show(props, client);
  await screen.findByTestId('probe-layout');
  return client;
}

/** Opens "…" (or View options) from the keyboard, as Radix menus open on Enter. */
async function openMenu(name: 'More actions' | 'View options') {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
  return screen.findByRole('menu');
}

function names(elements: HTMLElement[]): string[] {
  return elements.map((element) => element.textContent ?? '');
}

let writeText: Mock<(text: string) => Promise<void>>;

beforeEach(() => {
  panelProbe.props = null;
  localStorage.clear();
  writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('Toolbar', () => {
  it('shows Filter, Sort, Group, Search, Properties, "…" and New to someone who can edit', async () => {
    await shown();
    for (const name of ['Filter', 'Sort', 'Group', 'Search', 'Properties', 'More actions', 'New']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'View options' })).toBeInTheDocument();
  });

  it('leaves out Properties and New for someone who can only view', async () => {
    const client = mockClient();
    client.getDatabase.mockResolvedValue(jobsDatabase({ viewerAccess: 'view' }));
    await shown({}, client);
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Properties' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    await screen.findByTestId('probe-panel');
    expect(panelProbe.props?.canEditViews).toBe(false);
  });

  it('opens one panel at a time under the toolbar, and Esc gives focus back', async () => {
    await shown();
    const filter = screen.getByRole('button', { name: 'Filter' });
    fireEvent.click(filter);
    const panel = await screen.findByRole('dialog', { name: 'Filter' });
    expect(within(panel).getByText('Filter for All jobs')).toBeInTheDocument();
    expect(filter).toHaveAttribute('aria-expanded', 'true');
    expect(panelProbe.props).toMatchObject({ panel: 'filter', canEditViews: true });
    expect(panelProbe.props?.savedView.id).toBe(VIEWS.table);

    const sort = screen.getByRole('button', { name: 'Sort' });
    fireEvent.click(sort);
    expect(await screen.findByRole('dialog', { name: 'Sort' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Filter' })).toBeNull();
    expect(filter).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Sort' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(sort).toHaveFocus());
  });

  it("closes a panel from its button or the panel's own close", async () => {
    await shown();
    const group = screen.getByRole('button', { name: 'Group' });
    fireEvent.click(group);
    await screen.findByRole('dialog', { name: 'Group' });
    fireEvent.click(group);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(group);
    const panel = await screen.findByRole('dialog', { name: 'Group' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(group).toHaveFocus());
  });

  it('lists everything in "…" for Full access, and Delete only where the page allows it', async () => {
    const onDelete = vi.fn();
    await shown({ onDelete });
    const menu = await openMenu('More actions');
    expect(names(within(menu).getAllByRole('menuitem'))).toEqual([
      'Layout',
      'Import CSV',
      'Export CSV',
      'Row access',
      'Property access',
      'Copy link',
      'Delete',
    ]);
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Lock structure' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('gives Can edit Layout, Import CSV, Export CSV and Copy link in "…"', async () => {
    const client = mockClient();
    client.getDatabase.mockResolvedValue(jobsDatabase({ viewerAccess: 'edit' }));
    await shown({ onDelete: vi.fn() }, client);
    const menu = await openMenu('More actions');
    expect(names(within(menu).getAllByRole('menuitem'))).toEqual([
      'Layout',
      'Import CSV',
      'Export CSV',
      'Copy link',
    ]);
    expect(within(menu).queryByRole('menuitemcheckbox')).toBeNull();
  });

  it('opens Import CSV as a dialog with its title, and Close gives focus back to "…"', async () => {
    await shown();
    await openMenu('More actions');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import CSV' });
    expect(within(dialog).getByText('Import CSV for All jobs')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus());
  });

  it('turns Lock structure on for everyone, and says why when it is refused', async () => {
    const client = await shown();
    await openMenu('More actions');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Lock structure' }));
    await waitFor(() =>
      expect(client.updateDatabase).toHaveBeenCalledWith(JOBS_ID, { locked: true }),
    );

    client.updateDatabase.mockRejectedValueOnce(
      new ApiError(403, 'forbidden', "You don't have access to this."),
    );
    await openMenu('More actions');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Lock structure' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("You don't have access to this."),
    );
  });

  it('hides Properties and Layout while Lock structure is on', async () => {
    const client = mockClient();
    client.getDatabase.mockResolvedValue(jobsDatabase({ locked: true }));
    await shown({}, client);
    expect(screen.queryByRole('button', { name: 'Properties' })).toBeNull();
    const menu = await openMenu('More actions');
    expect(within(menu).queryByRole('menuitem', { name: 'Layout' })).toBeNull();
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Lock structure' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it("copies the link to the database's page with the view", async () => {
    await shown({ viewId: VIEWS.board });
    await openMenu('More actions');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Link copied.'));
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/p/${JOBS_ID}?v=${VIEWS.board}`,
    );
  });

  it("says so when the link can't be copied", async () => {
    writeText.mockRejectedValueOnce(new Error('Not allowed.'));
    await shown();
    await openMenu('More actions');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("Couldn't copy the link."),
    );
  });

  it("lists the toolbar's buttons in View options on a phone", async () => {
    await shown();
    const menu = await openMenu('View options');
    expect(names(within(menu).getAllByRole('menuitem')).slice(0, 5)).toEqual([
      'Filter',
      'Sort',
      'Group',
      'Search',
      'Properties',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Filter' }));
    const panel = await screen.findByRole('dialog', { name: 'Filter' });
    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'View options' })).toHaveFocus());
  });

  it("gives a panel the properties the viewer can see and linked rows' titles", async () => {
    const client = mockClient();
    const propertyIds = [PROPS.name, PROPS.status];
    const rowTitles = { 'row-office': 'Main office' };
    client.query.mockResolvedValue(queryData(undefined, { propertyIds, rowTitles }));
    await shown({}, client);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await screen.findByTestId('probe-panel');
    expect(panelProbe.props?.propertyIds).toEqual(propertyIds);
    expect(panelProbe.props?.rowTitles).toEqual(rowTitles);
  });

  it('keeps the sorts a viewer picks in a panel as their own', async () => {
    const client = mockClient();
    client.getDatabase.mockResolvedValue(jobsDatabase({ viewerAccess: 'view' }));
    await shown({}, client);
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    await screen.findByTestId('probe-panel');
    const byDue = [{ propertyId: PROPS.due, direction: 'asc' as const }];
    await act(() => panelProbe.props?.actions.updateView({ sorts: byDue }) ?? Promise.resolve());
    expect(await screen.findByText('Changed for you only')).toBeInTheDocument();
    expect(client.updateView).not.toHaveBeenCalled();
    expect(panelProbe.props?.view.sorts).toEqual(byDue);
  });
});

describe('Toolbar search', () => {
  it('asks for matching rows once typing stops, and Clear search shows them all again', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (_databaseId, request) =>
      request.search ? queryData([]) : queryData(),
    );
    await shown({}, client);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const box = screen.getByRole('searchbox', { name: 'Search' });
    expect(box).toHaveFocus();

    fireEvent.change(box, { target: { value: ' pump ' } });
    await waitFor(() =>
      expect(client.query).toHaveBeenLastCalledWith(JOBS_ID, {
        viewId: VIEWS.table,
        override: null,
        search: 'pump',
      }),
    );
    const empty = (await screen.findByText('No rows match.')).parentElement as HTMLElement;
    expect(within(empty).queryByRole('button', { name: 'Clear filters' })).toBeNull();

    fireEvent.click(within(empty).getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('Fix kitchen sink leak')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('empties and closes on Esc, giving focus back to Search', async () => {
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const box = screen.getByRole('searchbox', { name: 'Search' });
    fireEvent.change(box, { target: { value: 'sink' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search' })).toHaveFocus();
  });

  it("closes when it's left empty, and another view starts without it", async () => {
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.blur(screen.getByRole('searchbox', { name: 'Search' }));
    expect(screen.queryByRole('searchbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sink' } });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'By status' }));
    await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull());
  });
});
