import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { JOBS_ID, JOBS_PARENT_ID, mockClient, renderWithDatabase, VIEWS } from '../test-utils';
import { DatabasePage } from './database-page';
import { probe } from './test-layout';

vi.mock('../layouts', async () => {
  const { probeLayouts } = await import('./test-layout');
  return { LAYOUTS: probeLayouts() };
});

/** Shows the router's address, so a test can read what the page wrote to it. */
function Address() {
  const { pathname, search } = useLocation();
  return <output data-testid="address">{pathname + search}</output>;
}

function show(route: string, client = mockClient()) {
  return renderWithDatabase(
    <>
      <DatabasePage page={{ id: JOBS_ID }} />
      <Address />
    </>,
    { route, client },
  );
}

const address = () => screen.getByTestId('address').textContent;

/** Opens "…" from the keyboard (Radix menus open on Enter) and picks Delete. */
async function pickDelete() {
  fireEvent.keyDown(await screen.findByRole('button', { name: 'More actions' }), { key: 'Enter' });
  const menu = await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
}

beforeEach(() => {
  probe.props = null;
  localStorage.clear();
});

describe('DatabasePage', () => {
  it('shows the database whose id is the page id, as the page heading', async () => {
    const { client } = show(`/p/${JOBS_ID}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByTestId('database')).toHaveAttribute('data-database-id', JOBS_ID);
    expect(client.getDatabase).toHaveBeenCalledWith(JOBS_ID);
    expect(screen.getByRole('tab', { name: 'All jobs', selected: true })).toBeInTheDocument();
  });

  it('opens the view named by ?v= in the link', async () => {
    show(`/p/${JOBS_ID}?v=${VIEWS.board}`);
    expect(
      await screen.findByRole('tab', { name: 'By status', selected: true }),
    ).toBeInTheDocument();
    await waitFor(() => expect(probe.props?.view.id).toBe(VIEWS.board));
  });

  it('writes the picked view to the link and keeps the rest of it', async () => {
    show(`/p/${JOBS_ID}?comment=c-1`);
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'By status' }));
    await waitFor(() => expect(address()).toBe(`/p/${JOBS_ID}?comment=c-1&v=${VIEWS.board}`));
    expect(screen.getByRole('tab', { name: 'By status', selected: true })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'All jobs' }));
    await waitFor(() => expect(address()).toBe(`/p/${JOBS_ID}?comment=c-1&v=${VIEWS.table}`));
  });

  it('Delete moves the page to Trash and goes to the page it was in', async () => {
    const { client } = show(`/p/${JOBS_ID}?v=${VIEWS.board}`);
    await pickDelete();
    await waitFor(() => expect(address()).toBe(`/p/${JOBS_PARENT_ID}`));
    expect(client.getPage).toHaveBeenCalledWith(JOBS_ID);
    expect(client.trashPage).toHaveBeenCalledWith(JOBS_ID);
  });

  it('goes Home after Delete when the page was at the top of a space', async () => {
    const client = mockClient();
    client.getPage.mockResolvedValue({ id: JOBS_ID, kind: 'database', parentId: null });
    show(`/p/${JOBS_ID}`, client);
    await pickDelete();
    await waitFor(() => expect(address()).toBe('/'));
    expect(client.trashPage).toHaveBeenCalledWith(JOBS_ID);
  });

  it('stays on the page and says why when Delete is refused', async () => {
    const client = mockClient();
    client.trashPage.mockRejectedValue(
      new ApiError(403, 'forbidden', "You don't have access to this."),
    );
    show(`/p/${JOBS_ID}`, client);
    await pickDelete();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("You don't have access to this."),
    );
    expect(address()).toBe(`/p/${JOBS_ID}`);
  });
});
