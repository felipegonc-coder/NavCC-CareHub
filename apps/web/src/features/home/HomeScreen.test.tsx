import { DEFAULT_TIME_PREFS } from '@carehub/team-time';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import { HomeScreen, HomeView } from './HomeScreen';
import { HomeSection } from './HomeSection';
import type { HomeSectionEntry, HomeSectionId } from './sections';
import { createHomeServer, upcomingItem } from './testServer';

// Noon in Denver (the default time zone) on Tue, Oct 27 2026.
const NOW = new Date('2026-10-27T18:00:00.000Z');
const avery = { name: 'Avery Kim', prefs: DEFAULT_TIME_PREFS };
const zoom = { url: 'https://zoom.example/j/123', provider: 'zoom' } as const;

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

/** A section that lists `names`. */
function listing(id: HomeSectionId, title: string, names: string[]): HomeSectionEntry {
  const data = names.map((name) => ({ name }));
  const query = { data, isPending: false, isError: false, isFetching: false, refetch: () => {} };
  return {
    id,
    title,
    Component: () => (
      <HomeSection
        title={title}
        link={{ label: 'See all', to: '/' }}
        query={query}
        limit={5}
        empty="Nothing here."
        noun={title.toLowerCase()}
        itemKey={(item) => item.name}
        renderItem={(item) => <span>{item.name}</span>}
      />
    ),
  };
}

const regionNames = () =>
  screen
    .getAllByRole('region')
    .map((region) => within(region).getByRole('heading', { level: 2 }).textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW, shouldAdvanceTime: true });
  api = createHomeServer();
  globalThis.fetch = api.fetchStub;
  live = createFakeLive();
  setLiveClientForTest(live.client);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
  setLiveClientForTest(null);
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('Home', () => {
  it('greets the person by first name, with the date, in one main landmark', () => {
    render(<HomeView sections={[]} now={NOW} viewer={avery} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Good afternoon, Avery · Tuesday, October 27',
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('shows the sections in order, each a region named by its heading (HR-01)', () => {
    const sections = [
      listing('upcoming', 'Upcoming', ['Huddle']),
      listing('recent', 'Recent pages', ['Shift handover']),
    ];
    render(
      <MemoryRouter>
        <HomeView sections={sections} now={NOW} viewer={avery} />
      </MemoryRouter>,
    );
    expect(regionNames()).toEqual(['Upcoming', 'Recent pages']);
  });

  it('keeps the other sections working when one breaks (HR-05)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: HomeSectionEntry = {
      id: 'upcoming',
      title: 'Upcoming',
      Component: () => {
        throw new Error('Broken on purpose.');
      },
    };
    render(
      <MemoryRouter>
        <HomeView
          sections={[broken, listing('recent', 'Recent pages', ['Shift handover'])]}
          now={NOW}
          viewer={avery}
        />
      </MemoryRouter>,
    );
    const failed = screen.getByRole('region', { name: 'Upcoming' });
    expect(within(failed).getByRole('alert')).toHaveTextContent('Something went wrong here.');
    expect(screen.getByRole('region', { name: 'Recent pages' })).toHaveTextContent(
      'Shift handover',
    );
  });
});

describe('Upcoming', () => {
  const renderHome = () =>
    render(
      <Providers>
        <HomeScreen />
      </Providers>,
    );

  it('lists the rest of today and tomorrow, with Join from 10 minutes before (HR-02)', async () => {
    api.server.upcoming = [
      upcomingItem({
        id: 'over',
        title: 'Night shift notes',
        start: '2026-10-27T16:00:00.000Z',
        end: '2026-10-27T17:30:00.000Z',
        videoLink: zoom,
      }),
      upcomingItem({ id: 'huddle', videoLink: zoom }),
      upcomingItem({
        id: 'call',
        title: 'Family call',
        start: '2026-10-27T18:12:00.000Z',
        end: '2026-10-27T18:42:00.000Z',
        videoLink: { url: 'https://meet.example/abc', provider: 'google-meet' },
      }),
      upcomingItem({
        id: 'handover',
        title: '',
        start: '2026-10-27T22:00:00.000Z',
        end: '2026-10-27T22:30:00.000Z',
        href: '/calendar?event=handover&occurrence=2026-10-27T16:00',
      }),
      upcomingItem({
        id: 'training',
        title: 'Training day',
        allDay: true,
        start: '2026-10-28',
        end: '2026-10-29',
      }),
      upcomingItem({
        id: 'rounds',
        title: 'Morning rounds',
        start: '2026-10-28T15:00:00.000Z',
        end: '2026-10-28T16:00:00.000Z',
      }),
    ];
    renderHome();
    const region = await screen.findByRole('region', { name: 'Upcoming' });
    await within(region).findByText('Morning rounds');
    expect(api.server.calls).toEqual(['/api/calendar/upcoming?limit=10']);

    const [today, tomorrow] = within(region).getAllByRole('list');
    const rows = (list: HTMLElement) =>
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent);
    expect(
      within(region)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Today', 'Tomorrow']);
    expect(rows(today!)).toEqual([
      'Now Care team huddleJoin Care team huddle',
      '12:12 PM Family call',
      '4:00 PM (No title)',
    ]);
    expect(rows(tomorrow!)).toEqual(['All day Training day', '9:00 AM Morning rounds']);
    expect(within(region).getByRole('link', { name: '4:00 PM (No title)' })).toHaveAttribute(
      'href',
      '/calendar?event=handover&occurrence=2026-10-27T16:00',
    );
    const join = within(region).getByRole('link', { name: 'Join Care team huddle' });
    expect(join).toHaveAttribute('href', zoom.url);
    expect(join).toHaveAttribute('target', '_blank');
    expect(within(region).getByRole('link', { name: 'Open Calendar' })).toHaveAttribute(
      'href',
      '/calendar',
    );

    // Two minutes later the call is 10 minutes away, so it can be joined.
    vi.setSystemTime(new Date('2026-10-27T18:02:00.000Z'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(within(region).getByRole('link', { name: 'Join Family call' })).toHaveAttribute(
      'href',
      'https://meet.example/abc',
    );
  });

  it('says when nothing else is on today or tomorrow', async () => {
    renderHome();
    expect(await screen.findByText('Nothing else today or tomorrow.')).toBeInTheDocument();
  });

  it('updates live when the calendar changes', async () => {
    api.server.upcoming = [upcomingItem()];
    renderHome();
    await screen.findByText('Care team huddle');
    await act(() => live.open());
    api.server.upcoming = [
      upcomingItem(),
      upcomingItem({
        id: 'e2',
        title: 'Family call',
        start: '2026-10-27T19:00:00.000Z',
        end: '2026-10-27T19:30:00.000Z',
      }),
    ];
    await act(async () => {
      live.send({ type: 'calendar.changed' });
    });
    expect(await screen.findByText('Family call')).toBeInTheDocument();
  });

  it('says when it failed to load, and tries again (HR-05)', async () => {
    api.server.fail = 1;
    api.server.upcoming = [upcomingItem()];
    renderHome();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load upcoming events.");
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Care team huddle')).toBeInTheDocument();
  });
});
