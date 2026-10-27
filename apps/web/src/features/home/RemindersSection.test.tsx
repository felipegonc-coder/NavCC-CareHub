import { DEFAULT_TIME_PREFS } from '@carehub/team-time';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import { RemindersSection } from './RemindersSection';
import { createHomeServer, pendingReminder } from './testServer';

// Noon in Denver (the default time zone) on Tue, Oct 27 2026.
const NOW = new Date('2026-10-27T18:00:00.000Z');

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

const renderSection = () => {
  render(
    <Providers>
      <RemindersSection now={NOW} prefs={DEFAULT_TIME_PREFS} />
    </Providers>,
  );
  return screen.getByRole('region', { name: 'Reminders' });
};

const rowLinks = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('listitem')
    .map((item) => within(item).getByRole('link'));

describe('Reminders', () => {
  it('lists pending reminders with when they are due and their note', async () => {
    api.server.reminders = [
      pendingReminder(),
      pendingReminder({
        id: 'r2',
        target: { type: 'event', eventId: 'e1' },
        title: null,
        href: '/calendar?event=e1',
        dueAt: '2026-10-28T15:00:00.000Z',
        note: null,
      }),
    ];
    const region = renderSection();
    expect(await within(region).findByText('Shift handover')).toBeInTheDocument();
    const [page, event] = rowLinks(region);
    expect(page).toHaveAccessibleName('Shift handover Today, 3:00 PM · Check the queue');
    expect(page).toHaveAttribute('href', '/p/p1');
    // The person can't open the event any more, so it has no title.
    expect(event).toHaveAccessibleName("An event you can't open Tomorrow, 9:00 AM");
    expect(event).toHaveAttribute('href', '/calendar?event=e1');
  });

  it('shows the next 5, with See all for the rest', async () => {
    api.server.reminders = ['1', '2', '3', '4', '5', '6'].map((n) =>
      pendingReminder({ id: `r${n}`, title: `Page ${n}` }),
    );
    const region = renderSection();
    await within(region).findByText('Page 1');
    expect(rowLinks(region)).toHaveLength(5);
    expect(within(region).getByRole('link', { name: 'See all reminders' })).toHaveAttribute(
      'href',
      '/reminders',
    );
  });

  it("names and opens the page or event when the server doesn't say", async () => {
    api.server.reminders = [
      pendingReminder({
        title: undefined,
        href: undefined,
        target: { type: 'page', pageId: 'p9' },
      }),
      pendingReminder({ id: 'r2', href: undefined, target: { type: 'event', eventId: 'e9' } }),
    ];
    const region = renderSection();
    await within(region).findByText('Shift handover');
    const [page, event] = rowLinks(region);
    expect(page).toHaveAccessibleName('A page Today, 3:00 PM · Check the queue');
    expect(page).toHaveAttribute('href', '/p/p9');
    expect(event).toHaveAttribute('href', '/calendar?event=e9');
  });

  it('says how to add one when there are none, and updates live', async () => {
    renderSection();
    expect(
      await screen.findByText('No reminders. Use Remind me on a page or event.'),
    ).toBeInTheDocument();
    await act(() => live.open());
    api.server.reminders = [pendingReminder()];
    await act(async () => {
      live.send({ type: 'reminders-changed' });
    });
    expect(await screen.findByText('Shift handover')).toBeInTheDocument();
  });
});
