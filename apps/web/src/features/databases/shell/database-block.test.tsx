import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JOBS_ID, renderWithDatabase } from '../test-utils';
import { DatabaseBlock } from './database-block';
import { probe } from './test-layout';

vi.mock('../layouts', async () => {
  const { probeLayouts } = await import('./test-layout');
  return { LAYOUTS: probeLayouts() };
});

beforeEach(() => {
  probe.props = null;
  localStorage.clear();
});

describe('DatabaseBlock', () => {
  it('shows the inline database its node names, inside a node view wrapper', async () => {
    const { client, container } = renderWithDatabase(
      <DatabaseBlock node={{ attrs: { databaseId: JOBS_ID } }} />,
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByTestId('database')).toHaveAttribute('data-database-id', JOBS_ID);
    expect(await screen.findByTestId('probe-layout')).toBeInTheDocument();
    expect(client.getDatabase).toHaveBeenCalledWith(JOBS_ID);
    expect(container.firstElementChild).toHaveAttribute('data-node-view-wrapper');
    expect(container.firstElementChild).toHaveClass('whitespace-normal');
  });

  it('says the database is gone when the block names none, without Retry', () => {
    const { client } = renderWithDatabase(<DatabaseBlock node={{ attrs: { databaseId: null } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This was deleted, or the link is wrong.');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('database')).not.toBeInTheDocument();
    expect(client.getDatabase).not.toHaveBeenCalled();
  });
});
