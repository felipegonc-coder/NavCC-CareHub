import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import { SidebarUpcoming } from './SidebarUpcoming';
import { createHomeServer, upcomingItem } from './testServer';

// Noon in Denver (the default time zone) on Tue, Oct 27 2026.
const NOW = new Date('2026-10-27T18:00:00.000Z');
const zoom = { url: 'https://zoom.example/j/123', provider: 'zoom' } as const;

const realFetch = globalThis.fetch;
let api: ReturnType<typeof createHomeServer>;

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const renderSidebar = () =>
  render(
    <Providers>
      <SidebarUpcoming />
    </Providers>,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW, shouldAdvanceTime: true });
  api = createHomeServer();
  globalThis.fetch = api.fetchStub;
  setLiveClientForTest(createFakeLive().client);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  setLiveClientForTest(null);
});

describe('Sidebar Upcoming', () => {
  it('shows the next 3 events, each opening in Calendar, with Join when joinable', async () => {
    api.server.upcoming = [
      upcomingItem({
        id: 'over',
        title: 'Night shift notes',
        start: '2026-10-27T16:00:00.000Z',
        end: '2026-10-27T17:30:00.000Z',
      }),
      upcomingItem({ id: 'huddle', videoLink: zoom }),
      upcomingItem({
        id: 'call',
        title: 'Family call',
        start: '2026-10-27T18:12:00.000Z',
        end: '2026-10-27T18:42:00.000Z',
        videoLink: { url: 'https://meet.example/abc', provider: 'google-meet' },
        href: '/calendar?event=call',
      }),
      upcomingItem({
        id: 'handover',
        title: '',
        start: '2026-10-27T22:00:00.000Z',
        end: '2026-10-27T22:30:00.000Z',
      }),
      upcomingItem({
        id: 'rounds',
        title: 'Morning rounds',
        start: '2026-10-28T15:00:00.000Z',
        end: '2026-10-28T16:00:00.000Z',
      }),
    ];
    renderSidebar();
    const group = await screen.findByRole('group', { name: 'Upcoming' });
    await within(group).findByText('Family call');
    expect(
      within(group)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Now Care team huddle', '12:12 PM Family call', '4:00 PM (No title)']);
    expect(within(group).getByRole('heading', { level: 3 })).toHaveTextContent('Today');
    expect(within(group).getByRole('link', { name: '12:12 PM Family call' })).toHaveAttribute(
      'href',
      '/calendar?event=call',
    );
    const join = within(group).getByRole('link', { name: 'Join Care team huddle' });
    expect(join).toHaveAttribute('href', zoom.url);
    expect(join).toHaveAttribute('target', '_blank');
    // The call is 12 minutes away: no Join yet.
    expect(within(group).queryByRole('link', { name: 'Join Family call' })).toBeNull();
    expect(api.callsTo('/api/calendar/upcoming')).toEqual(['/api/calendar/upcoming?limit=10']);
  });

  it('puts tomorrow’s events under Tomorrow', async () => {
    api.server.upcoming = [
      upcomingItem({
        id: 'rounds',
        title: 'Morning rounds',
        start: '2026-10-28T15:00:00.000Z',
        end: '2026-10-28T16:00:00.000Z',
      }),
    ];
    renderSidebar();
    const group = await screen.findByRole('group', { name: 'Upcoming' });
    expect(await within(group).findByRole('heading', { level: 3 })).toHaveTextContent('Tomorrow');
    expect(within(group).getByRole('listitem')).toHaveTextContent('9:00 AM Morning rounds');
  });

  it('says when nothing else is on', async () => {
    renderSidebar();
    expect(await screen.findByText('Nothing else today')).toBeInTheDocument();
  });

  it('says when it failed to load, and tries again', async () => {
    api.server.fail = 1;
    api.server.upcoming = [upcomingItem()];
    renderSidebar();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load upcoming events.");
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Care team huddle')).toBeInTheDocument();
  });

  it('folds, and stays folded for the person', async () => {
    api.server.upcoming = [upcomingItem()];
    const first = renderSidebar();
    await screen.findByText('Care team huddle');
    const fold = screen.getByRole('button', { name: 'Hide upcoming events' });
    await waitFor(() => expect(fold).toBeEnabled());
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(fold);
    const unfold = await screen.findByRole('button', { name: 'Show upcoming events' });
    expect(unfold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Care team huddle')).toBeNull();
    await waitFor(() => expect(api.server.changes).toEqual([{ upcomingFolded: true }]));

    first.unmount();
    renderSidebar();
    expect(await screen.findByRole('button', { name: 'Show upcoming events' })).toBeEnabled();
    expect(screen.queryByText('Care team huddle')).toBeNull();
  });
});
