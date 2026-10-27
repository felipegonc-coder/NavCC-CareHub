import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from './routes';

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

describe('routes', () => {
  it('shows Home at /', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: /^Good / })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.title).toBe('Care Hub');
  });

  it('shows Not found, with a way home, for an unknown address', async () => {
    renderAt('/no/such/screen');
    expect(await screen.findByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument();
    expect(screen.getByText('This was deleted, or the link is wrong.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.title).toBe('Care Hub · Not found');
  });
});
