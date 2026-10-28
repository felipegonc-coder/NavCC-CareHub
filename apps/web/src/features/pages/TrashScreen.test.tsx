import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrashItem } from './api';
import { TrashScreen } from './TrashScreen';

const { api, toast, Refused } = vi.hoisted(() => {
  /** Stands in for ApiError. */
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
      delete: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
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

// Radix menus and selects measure themselves; jsdom can't.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const DAY = 86_400_000;
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

// Fictional things in Trash.
const item = (id: string, title: string, more: Partial<TrashItem> = {}): TrashItem => ({
  id,
  kind: 'page',
  title,
  icon: null,
  path: ['Support', 'Policies'],
  inside: 0,
  deletedBy: { id: 'sam', name: 'Sam Ortiz' },
  deletedAt: fromNow(-DAY),
  deletesAt: fromNow(29 * DAY - 60_000),
  canDelete: true,
  ...more,
});
const refunds = item('refunds', 'Refund steps', { inside: 12 });
const rota = item('rota', 'Weekend rota', { path: ['Care team'], deletedAt: fromNow(-60_000) });

function Opened() {
  return <p>Opened {useParams().pageId}</p>;
}

let inTrash: TrashItem[] = [];

function renderTrash(items: TrashItem[]) {
  inTrash = items;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/trash']}>
        <Routes>
          <Route path="/trash" element={<TrashScreen />} />
          <Route path="/p/:pageId" element={<Opened />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The list item for the entry whose read-out starts with `title`. */
async function entry(title: string) {
  const link = await screen.findByRole('link', { name: new RegExp(`^${title},`) });
  return link.closest('li') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (path) =>
    path === '/api/trash' ? { items: inTrash, retentionDays: 30 } : null,
  );
  api.post.mockImplementation(async (path) => {
    inTrash = inTrash.filter((thing) => path !== `/api/trash/${thing.id}/restore`);
    return null;
  });
  api.delete.mockImplementation(async (path) => {
    inTrash = inTrash.filter((thing) => path !== `/api/trash/${thing.id}`);
    return null;
  });
});

describe('TrashScreen', () => {
  it('lists the newest first, each read out in full, with the search ready to type in', async () => {
    renderTrash([refunds, rota]);
    const links = await screen.findAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Weekend rota, in Care team, deleted by Sam Ortiz 1 minute ago, deletes in 29 days',
      'Refund steps, in Support › Policies, deleted by Sam Ortiz yesterday, deletes in 29 days',
    ]);
    expect(links[1]).toHaveTextContent('Refund steps and 12 sub-pages');
    expect(links[1]).toHaveTextContent('Support › Policies · Deleted by Sam Ortiz yesterday');
    expect(screen.getByRole('searchbox', { name: 'Search Trash' })).toHaveFocus();
    expect(document.title).toBe('Care Hub · Trash');
  });

  it('moves through the items with the arrow keys and opens one', async () => {
    renderTrash([refunds, rota]);
    const search = screen.getByRole('searchbox', { name: 'Search Trash' });
    const [first, second] = await screen.findAllByRole('link');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second as HTMLElement, { key: 'ArrowUp' });
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowUp' });
    expect(search).toHaveFocus();
    fireEvent.click(second as HTMLElement);
    expect(await screen.findByText('Opened refunds')).toBeInTheDocument();
  });

  it('finds items by title, and clears the search when nothing matches', async () => {
    renderTrash([refunds, rota]);
    const search = screen.getByRole('searchbox', { name: 'Search Trash' });
    await screen.findAllByRole('link');
    fireEvent.change(search, { target: { value: 'rota' } });
    expect(screen.getAllByRole('link')).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'invoices' } });
    expect(screen.getByText('Nothing in Trash matches.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(search).toHaveValue('');
  });

  it('restores an item, which leaves the list', async () => {
    renderTrash([refunds, rota]);
    fireEvent.click(within(await entry('Refund steps')).getByRole('button', { name: 'Restore' }));
    expect(api.post).toHaveBeenCalledWith('/api/trash/refunds/restore', {});
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(1));
  });

  it('keeps an item it could not restore, and says so', async () => {
    renderTrash([refunds]);
    api.post.mockRejectedValueOnce(new Refused(500, 'Something went wrong.'));
    fireEvent.click(within(await entry('Refund steps')).getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Couldn't restore Refund steps. Try again.",
        variant: 'danger',
      }),
    );
    expect(await entry('Refund steps')).toBeInTheDocument();
  });

  it('offers to restore the parent too when it is in Trash', async () => {
    renderTrash([refunds, item('policies', 'Policies', { path: ['Support'] })]);
    api.post.mockRejectedValueOnce(
      new Refused(409, 'Its parent is in Trash.', {
        parent: { id: 'policies', title: 'Policies' },
      }),
    );
    fireEvent.click(within(await entry('Refund steps')).getByRole('button', { name: 'Restore' }));
    const ask = await screen.findByRole('dialog', { name: 'Policies is in Trash too' });
    expect(ask).toHaveTextContent('Restore it as well, or move Refund steps somewhere else?');
    expect(within(ask).getByRole('button', { name: 'Move to…' })).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole('button', { name: 'Restore both' }));
    await waitFor(() =>
      expect(api.post.mock.calls.map(([path]) => path)).toEqual([
        '/api/trash/refunds/restore',
        '/api/trash/policies/restore',
        '/api/trash/refunds/restore',
      ]),
    );
  });

  it('deletes an item forever once the person confirms', async () => {
    renderTrash([refunds, rota]);
    fireEvent.click(
      within(await entry('Refund steps')).getByRole('button', { name: 'Delete forever' }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: 'Delete Refund steps and 12 sub-pages forever?',
    });
    expect(confirm).toHaveTextContent("This can't be undone.");
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete forever' }));
    expect(api.delete).toHaveBeenCalledWith('/api/trash/refunds');
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(1));
  });

  it('restores several at once', async () => {
    renderTrash([refunds, rota]);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Refund steps' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Weekend rota' }));
    const selected = screen.getByRole('group', { name: 'Selected' });
    expect(selected).toHaveTextContent('2 selected');
    fireEvent.click(within(selected).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/^Trash is empty/)).toBeInTheDocument();
  });

  it("hides Delete forever from someone who can't delete the item", async () => {
    renderTrash([item('notes', 'Shift notes', { canDelete: false })]);
    const notes = await entry('Shift notes');
    expect(within(notes).queryByRole('button', { name: 'Delete forever' })).toBeNull();
  });

  it('says how long things stay when Trash is empty', async () => {
    renderTrash([]);
    expect(
      await screen.findByText('Trash is empty. Deleted pages stay here for 30 days.'),
    ).toBeInTheDocument();
  });

  it('offers Retry when Trash cannot load', async () => {
    api.get.mockRejectedValueOnce(new Refused(500, 'Something went wrong.'));
    renderTrash([refunds]);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await entry('Refund steps')).toBeInTheDocument();
  });
});
