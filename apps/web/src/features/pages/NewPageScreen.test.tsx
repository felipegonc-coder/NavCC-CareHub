import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewPageScreen } from './NewPageScreen';

const { api, Refused } = vi.hoisted(() => {
  /** Stands in for ApiError. */
  class Refused extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    api: {
      get: vi.fn<(path: string) => Promise<unknown>>(),
      post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
    },
    Refused,
  };
});
vi.mock('../../lib/api', () => ({ api, ApiError: Refused }));

/** Where "New page" lands, and what it tells the page screen. */
function Landed() {
  const location = useLocation();
  return <p>{`${location.pathname} ${JSON.stringify(location.state)}`}</p>;
}

function openNew() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/', '/new']} initialIndex={1}>
        <Routes>
          <Route path="/new" element={<NewPageScreen />} />
          <Route path="/p/:pageId" element={<Landed />} />
          <Route path="/" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (path) => {
    if (path !== '/api/spaces') return {};
    return {
      spaces: [
        { id: 'support', kind: 'open', name: 'Support', icon: null },
        { id: 'mine', kind: 'personal', name: 'Private', icon: null },
      ],
    };
  });
  api.post.mockResolvedValue({ id: 'new1' });
});

describe('NewPageScreen', () => {
  it('adds one untitled page at the top of Private and opens it with "Add to:"', async () => {
    openNew();
    expect(await screen.findByText('/p/new1 {"focusTitle":true,"addTo":true}')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/pages', {
      kind: 'page',
      title: '',
      spaceId: 'mine',
    });
  });

  it("says so when the person's role can't add pages", async () => {
    api.post.mockRejectedValue(new Refused(403, 'Forbidden'));
    openNew();
    expect(await screen.findByRole('heading', { name: "Can't add pages" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });

  it('offers Retry when adding the page fails, and adds it then', async () => {
    api.post.mockRejectedValueOnce(new Refused(500, 'Down'));
    openNew();
    expect(
      await screen.findByRole('heading', { name: "Couldn't add the page" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/^\/p\/new1 /)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
