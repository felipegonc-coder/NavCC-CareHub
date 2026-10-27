import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEntryActions, type MoveHost } from './actions';
import { pagesKeys } from './api';
import type { TreeNode } from './types';

const { api, toast, Refused } = vi.hoisted(() => {
  /** Stands in for ApiError: what the server says when it refuses a change. */
  class Refused extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  }
  return {
    api: {
      get: vi.fn<(path: string) => Promise<unknown>>(),
      post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      put: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      patch: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      delete: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
    },
    toast: vi.fn(),
    Refused,
  };
});
vi.mock('../../lib/api', () => ({ api, ApiError: Refused }));
vi.mock('@carehub/ui', () => ({ useToast: () => ({ toast }) }));

const node = (id: string, parentId: string | null, title: string): TreeNode => ({
  id,
  parentId,
  kind: 'page',
  title,
  icon: null,
  position: id,
  hasChildren: false,
  access: 'full',
});
// Fictional pages in a General space: Onboarding > Week one, and Rota.
const onboarding = node('a1', null, 'Onboarding');
const tree = [onboarding, node('a2', 'a1', 'Week one'), node('b1', null, 'Rota')];

function Opened() {
  return <p>Opened {useParams().pageId}</p>;
}

const host = { confirmMove: vi.fn<MoveHost['confirmMove']>() };

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(pagesKeys.tree('general'), tree);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {children}
        <Routes>
          <Route path="/p/:pageId" element={<Opened />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useEntryActions(host), { wrapper });
  const titles = () =>
    queryClient.getQueryData<TreeNode[]>(pagesKeys.tree('general'))?.map((page) => page.title);
  return { queryClient, result, titles };
}

beforeEach(() => {
  vi.clearAllMocks();
  const responses: Record<string, unknown> = {
    '/api/favorites': { favorites: [] },
    '/api/me/prefs': {},
    '/api/auth/me': { member: { permissions: ['pages.create'] } },
  };
  api.get.mockImplementation(async (path) => responses[path] ?? null);
  for (const method of [api.post, api.put, api.patch, api.delete]) method.mockResolvedValue(null);
});

describe('useEntryActions', () => {
  it("follows the person's role for adding pages", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.canCreate).toBe(true));
  });

  it('renames at once, and puts the title back if the server refuses', async () => {
    const { result, titles } = setup();
    let refuse: (error: unknown) => void = () => undefined;
    api.patch.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
    act(() => result.current.rename('a1', 'Welcome'));
    await waitFor(() => expect(titles()).toEqual(['Welcome', 'Week one', 'Rota']));
    expect(api.patch).toHaveBeenCalledWith('/api/pages/a1', { title: 'Welcome' });
    refuse(new Refused(403, "You can't edit this page."));
    await waitFor(() => expect(titles()).toEqual(['Onboarding', 'Week one', 'Rota']));
    expect(toast).toHaveBeenCalledWith({
      title: "Couldn't rename the page.",
      description: "You can't edit this page.",
      variant: 'danger',
    });
  });

  it('moves a page to Trash with everything under it', async () => {
    const { result, titles } = setup();
    act(() => result.current.trash(onboarding));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Moved to Trash' }));
    expect(api.delete).toHaveBeenCalledWith('/api/pages/a1');
    expect(titles()).toEqual(['Rota']);
  });

  it('stars a page and remembers that the person has starred one', async () => {
    const { queryClient, result } = setup();
    await waitFor(() => expect(queryClient.getQueryData(pagesKeys.favorites)).toEqual([]));
    await waitFor(() => expect(queryClient.getQueryData(pagesKeys.prefs)).toEqual({}));
    act(() => result.current.toggleFavorite(onboarding));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/favorites', { pageId: 'a1' }));
    expect(queryClient.getQueryData(pagesKeys.prefs)).toMatchObject({ 'sidebar.starred': true });
  });

  it('adds an untitled page and opens it', async () => {
    const { result } = setup();
    api.post.mockResolvedValueOnce({ id: 'new1' });
    act(() => result.current.create({ parentId: 'a1' }));
    expect(await screen.findByText('Opened new1')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/pages', {
      kind: 'page',
      title: '',
      parentId: 'a1',
    });
  });

  it('copies a link to the page', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { result } = setup();
    act(() => result.current.copyLink('a1'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ title: 'Link copied', variant: 'success' }),
    );
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/a1`);
  });

  it('moves a page at once, and back if the server refuses', async () => {
    const { queryClient, result, titles } = setup();
    let refuse: (error: unknown) => void = () => undefined;
    api.post.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
    act(() => result.current.move(onboarding, { spaceId: 'general', parentId: 'b1' }));
    await waitFor(() => expect(titles()).toEqual(['Rota', 'Onboarding', 'Week one']));
    expect(queryClient.getQueryData(pagesKeys.tree('general'))).toContainEqual(
      expect.objectContaining({ id: 'a1', parentId: 'b1' }),
    );
    expect(api.post).toHaveBeenCalledWith('/api/pages/a1/move', {
      spaceId: 'general',
      parentId: 'b1',
    });
    refuse(new Refused(400, "That page can't hold sub-pages."));
    await waitFor(() => expect(titles()).toEqual(['Onboarding', 'Week one', 'Rota']));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't move the page.", variant: 'danger' }),
    );
  });

  it('asks before a move that changes who can open the page', async () => {
    const { result } = setup();
    const change = { losing: [{ id: 'u1', name: 'Ana Silva' }], gaining: [] };
    api.post.mockRejectedValueOnce(new Refused(409, 'Access would change.', change));
    host.confirmMove.mockResolvedValueOnce(true);
    act(() => result.current.move(onboarding, { spaceId: 'care', parentId: null }));
    await waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith('/api/pages/a1/move', {
        spaceId: 'care',
        parentId: null,
        confirmAccessChange: true,
      }),
    );
    expect(host.confirmMove).toHaveBeenCalledWith(onboarding, {
      losing: ['Ana Silva'],
      gaining: [],
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it('leaves the page where it was when the person says no', async () => {
    const { result } = setup();
    api.post.mockRejectedValueOnce(new Refused(409, 'Access would change.', {}));
    host.confirmMove.mockResolvedValueOnce(false);
    act(() => result.current.move(onboarding, { spaceId: 'care', parentId: null }));
    await waitFor(() => expect(host.confirmMove).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
