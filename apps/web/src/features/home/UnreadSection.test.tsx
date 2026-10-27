import { DEFAULT_TIME_PREFS } from '@carehub/team-time';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import { createHomeServer } from './testServer';
import type { UnreadChat } from './unread';
import { UnreadList, UnreadSection, type CareHubUnread } from './UnreadSection';

// Noon in Denver (the default time zone) on Tue, Oct 27 2026.
const NOW = new Date('2026-10-27T18:00:00.000Z');
const prefs = DEFAULT_TIME_PREFS;

const realFetch = globalThis.fetch;
let api: ReturnType<typeof createHomeServer>;
let live: ReturnType<typeof createFakeLive>;

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  api = createHomeServer();
  globalThis.fetch = api.fetchStub;
  live = createFakeLive();
  setLiveClientForTest(live.client);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setLiveClientForTest(null);
});

function chat(id: string, overrides: Partial<UnreadChat> = {}): UnreadChat {
  return {
    chatId: id,
    name: `Chat ${id}`,
    preview: 'Can you cover the 2 PM queue?',
    unreadCount: 1,
    lastMessageAt: '2026-10-27T17:00:00.000Z',
    href: `/messages/${id}`,
    ...overrides,
  };
}

const loaded = (chats: UnreadChat[]) => ({
  data: chats,
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: () => {},
});

const reminder = { title: 'Reminder', sender: 'Reminders', latestAt: '2026-10-27T17:30:00.000Z' };

function renderList(chats: UnreadChat[], careHub: CareHubUnread) {
  render(
    <MemoryRouter>
      <UnreadList chats={loaded(chats)} careHub={careHub} now={NOW} prefs={prefs} />
    </MemoryRouter>,
  );
  return screen.getByRole('region', { name: 'Unread messages' });
}

const rowLinks = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('listitem')
    .map((item) => within(item).getByRole('link'));

describe('Unread messages', () => {
  it('puts 🔔 Care Hub first, then the chats, up to 5 in all (HR-01)', () => {
    const chats = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => chat(id));
    const region = renderList(chats, { unread: 3, latest: reminder });
    const links = rowLinks(region);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/messages/care-hub',
      '/messages/c1',
      '/messages/c2',
      '/messages/c3',
      '/messages/c4',
    ]);
    expect(links[0]).toHaveAccessibleName('Care Hub 11:30 AM Reminder 3 unread');
    expect(within(region).getByRole('link', { name: 'Open Messages' })).toHaveAttribute(
      'href',
      '/messages',
    );
  });

  it("shows each chat's name, preview, time and unread count", () => {
    const sam = chat('c1', {
      name: 'Sam Ortiz',
      unreadCount: 120,
      lastMessageAt: '2026-10-26T22:00:00.000Z',
    });
    const [link] = rowLinks(renderList([sam], { unread: 0, latest: null }));
    expect(link).toHaveAccessibleName(
      'Sam Ortiz Yesterday Can you cover the 2 PM queue? 99+ unread',
    );
  });

  it("leaves 🔔 Care Hub out once it's read, and says when everything is", () => {
    const region = renderList([], { unread: 0, latest: reminder });
    expect(rowLinks(region)).toEqual([]);
    expect(region).toHaveTextContent("You're all caught up.");
  });

  it('follows the 🔔 Care Hub chat live', async () => {
    api.server.notices = { unread: 1, latest: reminder };
    render(
      <Providers>
        <UnreadSection now={NOW} prefs={prefs} />
      </Providers>,
    );
    expect(await screen.findByRole('link', { name: /Care Hub/ })).toHaveAttribute(
      'href',
      '/messages/care-hub',
    );
    await act(() => live.open());
    api.server.notices = { unread: 0, latest: reminder };
    await act(async () => {
      live.send({ type: 'notices-changed' });
    });
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  });
});
