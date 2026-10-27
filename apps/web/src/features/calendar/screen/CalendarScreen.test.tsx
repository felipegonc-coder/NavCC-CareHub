import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderTargetContext } from '../../shell/header-context';
import { TEST_ZONE, testEvent, testLayer } from '../data/testItems';
import { CalendarScreen } from './CalendarScreen';

// Fictional data only: the week of Sunday, October 25, 2026, in Denver (UTC-6 until Nov 1).
const HUDDLE = 'Daily huddle, Tuesday, October 27, 9:00 to 9:15 AM, My events';
const OFFSITE =
  'Fictional offsite, Wednesday, October 28 to Thursday, October 29, All day, My events';
const items = [
  testEvent({
    id: 'ev-huddle',
    eventId: 'ev-huddle',
    layerId: 'my-events',
    title: 'Daily huddle',
    start: '2026-10-27T15:00:00.000Z',
    end: '2026-10-27T15:15:00.000Z',
  }),
  // On Meetings, which is off.
  testEvent(),
  testEvent({
    id: 'ev-offsite',
    eventId: 'ev-offsite',
    layerId: 'my-events',
    title: 'Fictional offsite',
    allDay: true,
    start: '2026-10-28',
    end: '2026-10-30',
    timeZone: null,
  }),
];
const layers = [
  testLayer('my-events', { kind: 'my-events', name: 'My events', color: 'blue', order: 0 }),
  testLayer('meetings', { on: false }),
];

let requests: string[] = [];
let failing = false;
let client: QueryClient;
/** The shell's top bar, where the screen puts Today, ‹ ›, the period and the views. */
let topBar: HTMLElement;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function serve(path: string) {
  requests.push(path);
  const url = new URL(path, 'http://localhost');
  if (failing) {
    return json(500, { error: { code: 'internal', message: 'Something went wrong. Try again.' } });
  }
  if (url.pathname === '/api/calendar/layers') return json(200, { layers });
  const range = { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
  return json(200, { ...range, timeZone: TEST_ZONE, items, truncated: false });
}

function Address() {
  return <output data-testid="address">{useLocation().search}</output>;
}

function open(url: string) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <HeaderTargetContext.Provider value={topBar}>
          <CalendarScreen />
        </HeaderTargetContext.Provider>
        <Address />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const address = () => screen.getByTestId('address').textContent;

beforeEach(() => {
  requests = [];
  failing = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  topBar = document.createElement('div');
  document.body.append(topBar);
  vi.stubGlobal('fetch', vi.fn(serve));
});

afterEach(() => {
  client.clear();
  topBar.remove();
  vi.unstubAllGlobals();
});

describe('CalendarScreen', () => {
  it('shows the week in the address with the items of the layers that are on', async () => {
    open('/calendar?date=2026-10-27');
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Calendar');
    expect(within(topBar).getByRole('button', { name: 'Week' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const day of ['Sunday, October 25', 'Tuesday, October 27', 'Saturday, October 31']) {
      expect(screen.getByRole('button', { name: day })).toBeInTheDocument();
    }

    await waitFor(() =>
      expect(screen.getByRole('button', { name: HUDDLE })).toHaveClass('bg-blue-bg'),
    );
    expect(screen.getByRole('button', { name: OFFSITE })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^QA calibration/ })).toBeNull();
    expect(requests).toContain('/api/calendar/items?from=2026-10-25&to=2026-11-01');
  });

  it('steps through the weeks, switches views and keeps both in the address', async () => {
    open('/calendar?date=2026-10-27');
    fireEvent.click(within(topBar).getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(address()).toBe('?date=2026-11-03'));
    await waitFor(() =>
      expect(requests).toContain('/api/calendar/items?from=2026-11-01&to=2026-11-08'),
    );

    fireEvent.click(within(topBar).getByRole('button', { name: 'Month' }));
    await waitFor(() => expect(address()).toBe('?date=2026-11-03&view=month'));
    expect(screen.getByTestId('calendar-day-2026-11-30')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Monday, November 30' }));
    await waitFor(() => expect(address()).toBe('?date=2026-11-30&view=day'));
    expect(within(topBar).getByRole('button', { name: 'Day' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(within(topBar).getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(address()).toBe('?view=day'));
  });

  it('opens on Day on phones', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 767px)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    open('/calendar?date=2026-10-27');
    for (const day of screen.getAllByRole('button', { name: 'Day' })) {
      expect(day).toHaveAttribute('aria-pressed', 'true');
    }
    await waitFor(() =>
      expect(requests).toContain('/api/calendar/items?from=2026-10-27&to=2026-10-28'),
    );
  });

  it('says when the calendar cannot load, and tries again', async () => {
    failing = true;
    open('/calendar?date=2026-10-27');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the calendar. Something went wrong. Try again.");

    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: HUDDLE })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
