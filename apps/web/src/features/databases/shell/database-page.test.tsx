import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JOBS_ID, renderWithDatabase, VIEWS } from '../test-utils';
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

function show(route: string) {
  return renderWithDatabase(
    <>
      <DatabasePage page={{ id: JOBS_ID }} />
      <Address />
    </>,
    { route },
  );
}

const address = () => screen.getByTestId('address').textContent;

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
});
