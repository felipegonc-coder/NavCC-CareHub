import type { UpdateEntry, UpdateListResponse } from '@carehub/extras/history';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { slots } from './slots';
import { closeVersionHistory, currentVersionHistory } from './store';
import { AVERY, PAGE, SAM } from './testServer';
import { UpdatesOverlay } from './UpdatesOverlay';
import { closeUpdates, currentUpdates } from './updatesStore';

const realFetch = globalThis.fetch;

// Two entries by Sam and one by Avery in the hour before this one, so they group the same way
// whenever the test runs.
const hour = new Date();
hour.setMinutes(0, 0, 0);
const at = (minute: number) => new Date(hour.getTime() - 3_600_000 + minute * 60_000).toISOString();
const ENTRIES: UpdateEntry[] = [
  { id: 'u-3', kind: 'edited', at: at(40), by: SAM, changes: 3, versionId: 'v-9' },
  {
    id: 'u-2',
    kind: 'moved',
    at: at(30),
    by: AVERY,
    move: { from: { kind: 'hidden' }, to: { kind: 'page', id: 'p-1', title: 'Policies' } },
  },
  {
    id: 'u-1',
    kind: 'renamed',
    at: at(20),
    by: SAM,
    title: { from: 'Refunds', to: 'Refund steps' },
  },
];

/** Serves `entries` (newest first), `pageSize` at a time, or answers `status`. */
function serve(entries: UpdateEntry[], { pageSize = 50, status = 200 } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (status !== 200 || !url.pathname.endsWith(`/pages/${PAGE.id}/updates`)) {
      const message = status === 403 ? "You don't have access to this." : 'Not found.';
      return new Response(JSON.stringify({ error: { code: 'refused', message } }), {
        status: status === 200 ? 404 : status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const start = Number(url.searchParams.get('before') ?? 0);
    const answer: UpdateListResponse = {
      updates: entries.slice(start, start + pageSize),
      nextCursor: start + pageSize < entries.length ? String(start + pageSize) : null,
    };
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
}

function openFromMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/p/${PAGE.id}`]}>
        <UpdatesOverlay />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const item = slots.pageMenuItems?.find((one) => one.id === 'history.updates');
  if (!item) throw new Error('No Updates menu item.');
  expect(item.label).toBe('Updates');
  act(() => item.onSelect(PAGE));
}

afterEach(() => {
  act(() => {
    closeUpdates();
    closeVersionHistory();
  });
  globalThis.fetch = realFetch;
});

describe('the Updates panel', () => {
  it('HT-08: opens from the page menu, grouped per person and hour, newest first', async () => {
    serve(ENTRIES);
    openFromMenu();
    const dialog = await screen.findByRole('dialog', { name: 'Updates' });
    expect(dialog).toHaveAccessibleDescription('Refund steps');
    const list = await within(dialog).findByRole('list', { name: 'Updates' });
    const groups = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.parentElement === list);
    expect(
      groups.map((group) =>
        within(group)
          .getAllByRole('listitem')
          .map((line) => line.textContent),
      ),
    ).toEqual([
      [
        'Sam Ortiz edited · 3 changesShow changes',
        'Sam Ortiz renamed the page from “Refunds” to “Refund steps”',
      ],
      ["Avery Lin moved the page from a page you can't open to Policies"],
    ]);
  });

  it('Show changes opens Version history on that version', async () => {
    serve(ENTRIES);
    openFromMenu();
    const button = await screen.findByRole('button', { name: 'Show changes' });
    // Only the edit has a version to show.
    expect(screen.getAllByRole('button', { name: 'Show changes' })).toHaveLength(1);
    fireEvent.click(button);
    expect(currentUpdates()).toBeNull();
    expect(currentVersionHistory()).toEqual({
      page: { id: PAGE.id, title: 'Refund steps' },
      versionId: 'v-9',
    });
  });

  it('shows older updates on request', async () => {
    serve(ENTRIES, { pageSize: 2 });
    openFromMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Show older updates' }));
    expect(await screen.findByText(/renamed the page/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older updates' })).not.toBeInTheDocument();
  });

  it('says when nothing has happened yet', async () => {
    serve([]);
    openFromMenu();
    expect(await screen.findByText('Nothing has happened on this page yet.')).toBeInTheDocument();
  });

  it('HT-15: shows no access, and nothing about the page, on a 403', async () => {
    serve(ENTRIES, { status: 403 });
    openFromMenu();
    expect(await screen.findByText("You don't have access to this.")).toBeInTheDocument();
    expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
  });
});
