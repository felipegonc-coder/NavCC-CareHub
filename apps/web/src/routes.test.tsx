import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from './routes';

function renderAt(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe('routes', () => {
  it('shows the home placeholder at /', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Care Hub' })).toBeInTheDocument();
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
