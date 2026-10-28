import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import type { NoticeCardView } from './api';
import { NoticesChat } from './index';
import NoticesChatView from './NoticesChatView';
import { at, createNoticesServer, FakeIntersectionObserver, notice, showEdge } from './testServer';

// Noon in Denver (the default time zone) on Tue, Oct 27 2026.
const NOW = new Date('2026-10-27T18:00:00.000Z');

const chat = () => [
  notice({ id: 'n1', position: 1, read: true, latestAt: '2026-10-26T16:00:00.000Z' }),
  notice({
    id: 'n2',
    position: 2,
    kind: 'mention',
    sender: 'Sam Ortiz',
    title: 'Mentioned you in a comment',
    text: 'Can you check the follow-up dates?',
    card: {
      type: 'page',
      state: 'open',
      pageId: 'page-1',
      href: '/p/page-1',
      title: 'Weekly notes',
      icon: { type: 'emoji', emoji: '🗒️' },
      spaceName: 'Team',
    },
    buttons: [{ type: 'link', label: 'Open', href: '/p/page-1' }],
    latestAt: '2026-10-27T15:30:00.000Z',
  }),
  notice({
    id: 'n3',
    position: 3,
    text: 'Call Jordan Patel about the new schedule.',
    buttons: [
      { type: 'action', label: 'Snooze', choices: ['15 min', '1 hour', 'Tomorrow 9 AM'] },
      { type: 'action', label: 'Done', choices: [] },
    ],
    count: 3,
    latestAt: '2026-10-27T17:00:00.000Z',
  }),
];

const realFetch = globalThis.fetch;
let api: ReturnType<typeof createNoticesServer>;

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderChat() {
  return render(
    <Providers>
      <NoticesChatView />
    </Providers>,
  );
}

const listUrls = () =>
  api.server.calls.filter((c) => c.url.startsWith('/api/notices?')).map((c) => c.url);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW, shouldAdvanceTime: true });
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  api = createNoticesServer(chat());
  globalThis.fetch = api.fetchStub;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setLiveClientForTest(null);
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('NoticesChat', () => {
  it('shows notices oldest first under day dividers, with who sent them and when', async () => {
    renderChat();
    const items = await screen.findAllByRole('article');
    expect(items).toHaveLength(3);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Yesterday',
      'Today',
    ]);

    const mention = at(items, 1);
    expect(mention).toHaveAccessibleName('Sam Ortiz Mentioned you in a comment');
    expect(mention).toHaveTextContent('9:30 AM');
    expect(mention).toHaveTextContent('Can you check the follow-up dates?');
    expect(within(mention).getByText('💬')).toBeInTheDocument();
    expect(at(items, 0)).toHaveTextContent('10:00 AM');
    expect(within(at(items, 2)).getByText('⏰')).toBeInTheDocument();
    expect(
      screen.getByText('Care Hub sends reminders, automations and alerts here.'),
    ).toBeVisible();
  });

  it('marks unread notices, and shows how many notices were grouped', async () => {
    renderChat();
    const items = await screen.findAllByRole('article');
    expect(within(at(items, 0)).queryByText('Unread')).toBeNull();
    expect(within(at(items, 1)).getByText('Unread')).toBeInTheDocument();
    expect(within(at(items, 2)).getByText('· 3 notices')).toBeInTheDocument();
    expect(within(at(items, 1)).queryByText(/notices$/)).toBeNull();
  });

  it('puts the "New messages" line above the first unread notice', async () => {
    renderChat();
    await screen.findAllByRole('article');
    const line = screen.getByText('New messages');
    const item = line.closest('li');
    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByRole('article')).toHaveAccessibleName(
      'Sam Ortiz Mentioned you in a comment',
    );
  });

  it('shows cards for the reader: open, locked or deleted, never a hidden title', async () => {
    api.server.notices = [
      notice({ id: 'page', position: 1, card: at(chat(), 1).card }),
      notice({
        id: 'event',
        position: 2,
        card: {
          type: 'event',
          state: 'open',
          eventId: 'event-1',
          occurrenceStart: null,
          href: '/calendar?event=event-1',
          title: 'Team sync',
          when: 'Tue, Oct 27 · 3:00 PM',
        },
      }),
      notice({ id: 'locked', position: 3, card: { type: 'page', state: 'locked' } }),
      notice({ id: 'gone', position: 4, card: { type: 'event', state: 'deleted' } }),
    ];
    renderChat();
    await screen.findAllByRole('article');
    const page = screen.getByRole('link', { name: /Weekly notes/ });
    expect(page).toHaveAttribute('href', '/p/page-1');
    expect(page).toHaveTextContent('Team');
    const event = screen.getByRole('link', { name: /Team sync/ });
    expect(event).toHaveAttribute('href', '/calendar?event=event-1');
    expect(event).toHaveTextContent('Tue, Oct 27 · 3:00 PM');
    expect(screen.getByText("🔒 A page you can't open")).toBeInTheDocument();
    expect(screen.getByText('This event was deleted')).toBeInTheDocument();
  });

  it("shows each of a notice's cards in order, each by the reader's access", async () => {
    const page = (pageId: string, title: string): NoticeCardView => ({
      type: 'page',
      state: 'open',
      pageId,
      href: `/p/${pageId}`,
      title,
      icon: null,
      spaceName: null,
    });
    const first = page('page-1', 'Weekly notes');
    api.server.notices = [
      notice({
        kind: 'automation',
        card: first,
        cards: [first, { type: 'page', state: 'locked' }, page('page-2', 'Intake checklist')],
      }),
    ];
    renderChat();
    const article = await screen.findByRole('article');
    const links = within(article).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/p/page-1', '/p/page-2']);
    expect(article).toHaveTextContent(/Weekly notes.*can't open.*Intake checklist/);
  });

  it('filters with the chips, and offers All when a chip has nothing', async () => {
    renderChat();
    await screen.findAllByRole('article');
    const all = screen.getByRole('button', { name: 'All' });
    const mentions = screen.getByRole('button', { name: 'Mentions and replies' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(mentions).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(mentions);
    expect(mentions).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(listUrls()).toContain('/api/notices?filter=mentions&limit=50');

    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    expect(await screen.findByText('No notices here.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3));
    expect(all).toHaveAttribute('aria-pressed', 'true');
  });

  it('says when the chat is empty', async () => {
    api.server.notices = [];
    renderChat();
    expect(await screen.findByText('No notices yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it("says why the chat didn't load, and tries again", async () => {
    api.server.failLists = 1;
    renderChat();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your notices.");
    expect(alert).toHaveTextContent('The server broke.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByRole('article')).toHaveLength(3);
  });

  it('shows a skeleton only when loading takes a while', async () => {
    api.server.holdLists = true;
    renderChat();
    expect(screen.queryByText('Loading notices')).toBeNull();
    expect(await screen.findByText('Loading notices', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('marks notices read up to the newest when the end of the chat is in view', async () => {
    renderChat();
    await screen.findAllByRole('article');
    expect(api.server.posts()).toEqual([]);
    await act(async () => showEdge('bottom'));
    await waitFor(() =>
      expect(api.server.posts()).toEqual([['/api/notices/read', { through: 3 }]]),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled(),
    );
    // The line stays where the unread notices started.
    expect(screen.getByText('New messages')).toBeInTheDocument();
  });

  it("doesn't mark notices read from a filtered view or a tab in the background", async () => {
    renderChat();
    await screen.findAllByRole('article');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => showEdge('bottom'));
    expect(api.server.posts()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Reminders' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
    Reflect.deleteProperty(document, 'visibilityState');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => showEdge('bottom'));
    expect(api.server.posts()).toEqual([]);
  });

  it('marks everything read', async () => {
    renderChat();
    const button = await screen.findByRole('button', { name: 'Mark all as read' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(api.server.posts()).toEqual([['/api/notices/read-all', undefined]]));
    await waitFor(() => expect(button).toBeDisabled());
    for (const item of screen.getAllByRole('article')) {
      expect(within(item).queryByText('Unread')).toBeNull();
    }
  });

  it('marks a notice read when one of its links is opened', async () => {
    renderChat();
    await screen.findAllByRole('article');
    fireEvent.click(screen.getByRole('link', { name: 'Open' }));
    await waitFor(() => expect(api.server.posts()).toEqual([['/api/notices/n2/read', undefined]]));
  });

  it('runs action buttons and shows what happened', async () => {
    renderChat();
    await screen.findAllByRole('article');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Marked done')).toBeInTheDocument();
    expect(api.server.posts()).toEqual([['/api/notices/n3/actions', { button: 1 }]]);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Snooze' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '1 hour' }));
    expect(await screen.findByText('Snoozed for 1 hour')).toBeInTheDocument();
    expect(api.server.posts()).toContainEqual([
      '/api/notices/n3/actions',
      { button: 0, choice: 1 },
    ]);
  });

  it('loads older notices from the button or when the top comes into view', async () => {
    api.server.pageSize = 1;
    renderChat();
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Load older notices' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
    expect(listUrls()).toContain('/api/notices?filter=all&limit=50&before=3');

    await act(async () => showEdge('top'));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3));
    expect(screen.queryByRole('button', { name: 'Load older notices' })).toBeNull();
  });

  it('tells screen readers about notices that arrive while it is open', async () => {
    const live = createFakeLive();
    setLiveClientForTest(live.client);
    renderChat();
    await screen.findAllByRole('article');
    await act(() => live.open());
    api.server.add(
      notice({ id: 'n4', position: 4, kind: 'reply', sender: 'Ana Ruiz', title: 'Replied' }),
    );
    await act(async () => {
      live.send({ type: 'notices-changed' });
    });
    expect(await screen.findByText('New notice from Ana Ruiz: Replied')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('moves between notices with the arrow keys, and Tab stops at one of them', async () => {
    renderChat();
    const items = await screen.findAllByRole('article');
    expect(items.map((item) => item.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
    await act(async () => at(items, 0).focus());
    fireEvent.keyDown(at(items, 0), { key: 'ArrowDown' });
    expect(at(items, 1)).toHaveFocus();
    fireEvent.keyDown(at(items, 1), { key: 'ArrowUp' });
    expect(at(items, 0)).toHaveFocus();
    expect(at(items, 0)).toHaveAttribute('tabindex', '0');
  });

  it('offers a jump to the newest notice when scrolled up', async () => {
    renderChat();
    const items = await screen.findAllByRole('article');
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    await act(async () => showEdge('bottom', false));
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(at(items, 2)).toHaveFocus();
  });

  it('loads lazily for Messages', async () => {
    render(
      <Providers>
        <Suspense fallback={null}>
          <NoticesChat />
        </Suspense>
      </Providers>,
    );
    expect(await screen.findByRole('group', { name: 'Filter notices' })).toBeInTheDocument();
    expect(await screen.findAllByRole('article')).toHaveLength(3);
  });
});
