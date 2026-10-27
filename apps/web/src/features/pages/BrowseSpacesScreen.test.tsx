import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowseSpacesScreen } from './BrowseSpacesScreen';
import type { BrowseSpace } from './types';

const { api, toast, Refused } = vi.hoisted(() => {
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
    toast: vi.fn(),
    Refused,
  };
});
vi.mock('../../lib/api', () => ({ api, ApiError: Refused }));
vi.mock('@carehub/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@carehub/ui')>()),
  useToast: () => ({ toast }),
}));

// A fictional workspace's Open and Closed spaces.
const spaces: BrowseSpace[] = [
  {
    id: 'general',
    kind: 'open',
    name: 'General',
    icon: null,
    description: 'News for everyone.',
    memberCount: 24,
    membership: 'member',
  },
  {
    id: 'care',
    kind: 'closed',
    name: 'Care team',
    icon: { type: 'emoji', emoji: '🩺' },
    description: 'Rotas and handovers.',
    memberCount: 1,
    membership: null,
  },
  { id: 'billing', kind: 'closed', name: 'Billing', icon: null, membership: 'requested' },
  { id: 'social', kind: 'open', name: 'Social club', icon: null, memberCount: 7, membership: null },
];

function show(responses: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    '/api/spaces/browse': { spaces },
    '/api/auth/me': { member: { permissions: ['pages.create'] } },
    ...responses,
  };
  api.get.mockImplementation(async (path) => {
    const value = data[path];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`Unexpected GET ${path}`);
    return value;
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <BrowseSpacesScreen />
    </QueryClientProvider>,
  );
}

/** The list as the server sends it once the person has joined or asked to join. */
const after = (id: string, membership: BrowseSpace['membership']) => ({
  spaces: spaces.map((space) => (space.id === id ? { ...space, membership } : space)),
});

const entries = () =>
  within(screen.getByRole('list', { name: 'Spaces' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  api.post.mockResolvedValue({ status: 'joined' });
});

describe('BrowseSpacesScreen', () => {
  it('lists each space with its description, kind, members and where the person stands', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Browse spaces' })).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Spaces' });
    expect(entries()).toEqual([
      'GeneralNews for everyone.Open · 24 membersJoined',
      '🩺Care teamRotas and handovers.Closed · 1 memberRequest to join',
      'BillingClosedRequested',
      'Social clubOpen · 7 membersJoin',
    ]);
    expect(screen.getByRole('button', { name: 'Joined General' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Requested to join Billing' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('searchbox', { name: 'Find a space' })).toHaveFocus();
  });

  it('joins an Open space, keeping focus on its button', async () => {
    show();
    const join = await screen.findByRole('button', { name: 'Join Social club' });
    api.get.mockResolvedValue(after('social', 'member'));
    join.focus();
    fireEvent.click(join);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/spaces/social/join'));
    expect(await screen.findByRole('button', { name: 'Joined Social club' })).toBe(join);
    expect(join).toHaveFocus();
    expect(toast).toHaveBeenCalledWith({
      title: 'Joined “Social club”.',
      description: 'Its pages are in your sidebar.',
    });
  });

  it("asks a Closed space's owners to let the person in", async () => {
    api.post.mockResolvedValue({ status: 'requested' });
    show();
    const ask = await screen.findByRole('button', { name: 'Request to join Care team' });
    api.get.mockResolvedValue(after('care', 'requested'));
    fireEvent.click(ask);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/spaces/care/join'));
    expect(
      await screen.findByRole('button', { name: 'Requested to join Care team' }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(toast).toHaveBeenCalledWith({
      title: 'Asked to join “Care team”.',
      description: 'Its owners will get a notice.',
    });
  });

  it('says why joining failed, and offers Join again', async () => {
    api.post.mockRejectedValue(new Refused(403, "Guests can't join spaces."));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Social club' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Couldn't join “Social club”.",
        description: "Guests can't join spaces.",
        variant: 'danger',
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Join Social club' })).not.toHaveAttribute(
        'aria-disabled',
      ),
    );
  });

  it('finds spaces by name or description', async () => {
    show();
    const search = await screen.findByRole('searchbox', { name: 'Find a space' });
    await screen.findByRole('list', { name: 'Spaces' });
    fireEvent.change(search, { target: { value: 'ROTAS' } });
    expect(entries()).toEqual(['🩺Care teamRotas and handovers.Closed · 1 memberRequest to join']);
    expect(screen.getByRole('status')).toHaveTextContent('1 space found');
    fireEvent.change(search, { target: { value: 'garden' } });
    expect(screen.getByText('No spaces match “garden”.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(entries()).toHaveLength(4);
    expect(search).toHaveFocus();
  });

  it('says when there are no spaces to join yet', async () => {
    show({ '/api/spaces/browse': { spaces: [] } });
    expect(await screen.findByText('There are no Open or Closed spaces yet.')).toBeInTheDocument();
  });

  it('offers Retry when the spaces fail to load', async () => {
    show({ '/api/spaces/browse': new Error('offline') });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    api.get.mockResolvedValueOnce({ spaces });
    fireEvent.click(retry);
    expect(await screen.findByRole('list', { name: 'Spaces' })).toBeInTheDocument();
  });

  it('offers Create space only to people who may create pages', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'Create space' })).toBeInTheDocument();
  });

  it('leaves Create space out for people who may not', async () => {
    show({ '/api/auth/me': { member: { permissions: [] } } });
    await screen.findByRole('list', { name: 'Spaces' });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/auth/me'));
    expect(screen.queryByRole('button', { name: 'Create space' })).not.toBeInTheDocument();
  });
});
