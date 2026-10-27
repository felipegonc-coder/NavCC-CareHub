import type { Connection, ConnectionsResponse } from '@carehub/team-calendar-api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveClientForTest } from '../../live/client';
import { createFakeLive } from '../../live/testSource';
import { LIMIT_MESSAGE } from './ConnectedCalendars';
import { TRUNCATED_NOTE } from './ConnectionItem';
import { browser } from './data';
import { ConnectionsScreen } from './index';
import { connectionsRoutes } from './routes';

const BASE = '/api/calendar/connections';
const GOOGLE_SIGN_IN = 'https://accounts.google.com/o/oauth2/v2/auth?state=test-state';
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const google = (change: Partial<Connection> = {}): Connection => ({
  id: 'conn-google',
  kind: 'google',
  label: 'Work',
  account: 'a…@example.com',
  status: 'ok',
  lastError: null,
  lastSyncedAt: minutesAgo(5),
  calendars: [
    { id: 'cal-rota', name: 'Team rota', color: 'blue', shown: true, truncated: false },
    { id: 'cal-family', name: 'Family', color: 'green', shown: false, truncated: false },
  ],
  ...change,
});

const link = (change: Partial<Connection> = {}): Connection => ({
  id: 'conn-link',
  kind: 'link',
  label: 'School',
  account: null,
  status: 'error',
  lastError: "Care Hub couldn't read this calendar link. Check that it still works.",
  lastSyncedAt: null,
  calendars: [{ id: 'cal-school', name: 'School', color: 'orange', shown: true, truncated: true }],
  ...change,
});

type Call = { method: string; url: string; body: unknown };

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake of the server's connection routes, keeping its list as the screen changes it. */
function serve(start: Partial<ConnectionsResponse> = {}) {
  const server = {
    data: {
      connections: [google(), link()],
      unavailable: { google: null, links: null },
      ...start,
    } as ConnectionsResponse,
    calls: [] as Call[],
    /** The list doesn't load. */
    down: false,
    /** Changes fail with this message. */
    refuse: null as string | null,
    gets: () => server.calls.filter((call) => call.method === 'GET').length,
    sent: (method: string) => server.calls.filter((call) => call.method === method),
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    server.calls.push({ method, url, body });
    if (method === 'GET') {
      return server.down ? reply(500, {}) : reply(200, server.data);
    }
    if (server.refuse) return reply(400, { error: { code: 'invalid', message: server.refuse } });
    if (url === `${BASE}/google`) return reply(200, { url: GOOGLE_SIGN_IN });
    if (url === `${BASE}/links`) {
      const added = link({ id: 'conn-new', status: 'ok', lastError: null, ...(body as object) });
      server.data.connections.push(added);
      return reply(201, { connection: added });
    }
    const [, id, action] = /^\/api\/calendar\/connections\/([^/]+)(\/sync)?$/.exec(url) ?? [];
    const found = server.data.connections.find((connection) => connection.id === id);
    if (!found) return reply(404, { error: { code: 'not_found', message: 'Not found.' } });
    if (method === 'DELETE') {
      server.data.connections = server.data.connections.filter((item) => item !== found);
      return new Response(null, { status: 204 });
    }
    if (method === 'PATCH') {
      const { calendars = [] } = body as { calendars?: { id: string; shown: boolean }[] };
      for (const change of calendars) {
        const calendar = found.calendars.find((item) => item.id === change.id);
        if (calendar) calendar.shown = change.shown;
      }
      return reply(200, { connection: found });
    }
    if (action) {
      Object.assign(found, { status: 'ok', lastError: null, lastSyncedAt: minutesAgo(0) });
      return reply(200, { connection: found });
    }
    return reply(404, { error: { code: 'not_found', message: 'Not found.' } });
  });
  return server;
}

/** The query string, to see the screen tidy it up. */
function Search() {
  return <span data-testid="search">{useLocation().search}</span>;
}

function show(path = '/calendar/connections') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/calendar/connections"
            element={
              <>
                <ConnectionsScreen />
                <Search />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const item = async (name: string) => within(await screen.findByRole('listitem', { name }));

let live: ReturnType<typeof createFakeLive>;
let opened: ReturnType<typeof vi.fn>;

beforeEach(() => {
  live = createFakeLive();
  setLiveClientForTest(live.client);
  opened = vi.fn();
  vi.spyOn(browser, 'open').mockImplementation(opened);
});

afterEach(() => {
  setLiveClientForTest(null);
  vi.restoreAllMocks();
});

describe('Connected calendars', () => {
  it('loads lazily at /calendar/connections', () => {
    expect(connectionsRoutes.map((route) => route.path)).toEqual(['calendar/connections']);
    expect(connectionsRoutes.every((route) => typeof route.lazy === 'function')).toBe(true);
  });

  it('lists each connection with its account, status and last sync, never more', async () => {
    serve();
    show();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Connected calendars' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Connected calendars');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const work = await item('Work');
    expect(work.getByText('Google Calendar · Connected as a…@example.com')).toBeInTheDocument();
    expect(work.getByText('Up to date. Last synced 5 minutes ago.')).toBeInTheDocument();
    expect(work.getByRole('checkbox', { name: 'Team rota' })).toBeChecked();
    expect(work.getByRole('checkbox', { name: 'Family' })).not.toBeChecked();
    const school = await item('School');
    expect(school.getByText(/^Care Hub couldn't read this calendar link\./)).toBeInTheDocument();
    expect(school.getByText(/Not synced yet\.$/)).toBeInTheDocument();
    expect(school.getByText(TRUNCATED_NOTE)).toBeInTheDocument();
    expect(school.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(school.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
  });

  it("connects Google Calendar by going to Google's sign-in", async () => {
    const server = serve();
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Google Calendar' }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith(GOOGLE_SIGN_IN));
    expect(server.sent('POST')).toEqual([{ method: 'POST', url: `${BASE}/google`, body: {} }]);
  });

  it('reconnects a Google connection that needs a new sign-in', async () => {
    const lastError = 'Google needs you to sign in again.';
    const server = serve({ connections: [google({ status: 'needs-reconnect', lastError })] });
    show();
    const work = await item('Work');
    expect(work.getByText(/^Google needs you to sign in again\. Last synced/)).toBeInTheDocument();
    expect(work.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
    fireEvent.click(work.getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith(GOOGLE_SIGN_IN));
    expect(server.sent('POST')[0]?.body).toEqual({ connectionId: 'conn-google' });
  });

  it("says why a way to connect is off, and when there's no room for another", async () => {
    serve({ unavailable: { google: "Google sign-in isn't set up yet.", links: null } });
    show();
    const connect = await screen.findByRole('button', { name: 'Connect Google Calendar' });
    expect(connect).toBeDisabled();
    expect(connect).toHaveAccessibleDescription("Google sign-in isn't set up yet.");
    expect(screen.getByRole('button', { name: 'Add a calendar link' })).toBeEnabled();
  });

  it('turns both ways off at 10 connections', async () => {
    const connections = Array.from({ length: 10 }, (_, n) =>
      link({ id: `conn-${n}`, label: `Link ${n}` }),
    );
    serve({ connections });
    show();
    const connect = await screen.findByRole('button', { name: 'Connect Google Calendar' });
    const add = screen.getByRole('button', { name: 'Add a calendar link' });
    for (const button of [connect, add]) {
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(LIMIT_MESSAGE);
    }
  });

  it('adds a calendar link with a name and a colour', async () => {
    const server = serve({ connections: [] });
    show();
    expect(await screen.findByText('No connected calendars yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a calendar link' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add a calendar link' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Add calendar' }));
    expect(dialog.getByText('Give it a name.')).toBeInTheDocument();
    expect(
      dialog.getByText('Use a link that starts with https:// or webcal://.'),
    ).toBeInTheDocument();
    expect(server.sent('POST')).toEqual([]);

    fireEvent.change(dialog.getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'School' },
    });
    fireEvent.change(dialog.getByRole('textbox', { name: /^Link/ }), {
      target: { value: 'webcal://calendar.example.com/school.ics' },
    });
    fireEvent.click(dialog.getByRole('radio', { name: 'Orange' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Add calendar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(server.sent('POST')[0]?.body).toEqual({
      url: 'webcal://calendar.example.com/school.ics',
      label: 'School',
      color: 'orange',
    });
    expect(await screen.findByRole('listitem', { name: 'School' })).toBeInTheDocument();
  });

  it("shows the server's reason when it can't add a link", async () => {
    const server = serve({ connections: [] });
    server.refuse =
      "Care Hub couldn't read that link. Check that it's the calendar's private link.";
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a calendar link' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add a calendar link' }));
    fireEvent.change(dialog.getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Swimming' },
    });
    fireEvent.change(dialog.getByRole('textbox', { name: /^Link/ }), {
      target: { value: 'https://calendar.example.org/swim.ics' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Add calendar' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(server.refuse);
  });

  it('shows or hides one of the Google calendars', async () => {
    const server = serve();
    show();
    const work = await item('Work');
    fireEvent.click(work.getByRole('checkbox', { name: 'Family' }));
    await waitFor(() => expect(work.getByRole('checkbox', { name: 'Family' })).toBeChecked());
    expect(server.sent('PATCH')).toEqual([
      {
        method: 'PATCH',
        url: `${BASE}/conn-google`,
        body: { calendars: [{ id: 'cal-family', shown: true }] },
      },
    ]);
  });

  it('syncs again after a problem', async () => {
    const server = serve();
    show();
    const school = await item('School');
    fireEvent.click(school.getByRole('button', { name: 'Retry' }));
    expect(await school.findByText(/^Up to date\. Last synced/)).toBeInTheDocument();
    expect(server.sent('POST')).toEqual([
      { method: 'POST', url: `${BASE}/conn-link/sync`, body: undefined },
    ]);
  });

  it('removes a connection after asking first', async () => {
    const server = serve();
    show();
    const school = await item('School');
    fireEvent.click(school.getByRole('button', { name: 'Remove' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Remove School?' }));
    expect(dialog.getByText(/Nothing changes in the calendar itself\./)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'School', hidden: true })).not.toBeInTheDocument();
    expect(server.sent('DELETE')).toEqual([
      { method: 'DELETE', url: `${BASE}/conn-link`, body: undefined },
    ]);
  });

  it("explains a Google sign-in that didn't finish, and lets it go", async () => {
    serve();
    show('/calendar/connections?problem=missing-scopes');
    expect(
      await screen.findByText(
        'Care Hub needs to see your calendars and their events. Please connect again and allow both.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Care Hub needs to see your calendars/)).not.toBeInTheDocument();
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();
  });

  it('has a plain sentence for a problem it does not know', async () => {
    serve();
    show('/calendar/connections?problem=something-new');
    expect(
      await screen.findByText("Connecting didn't work. Please try again."),
    ).toBeInTheDocument();
  });

  it('asks which calendars to show right after connecting Google', async () => {
    const server = serve();
    show('/calendar/connections?connected=conn-google');
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Google Calendar is connected' }),
    );
    expect(dialog.getByRole('checkbox', { name: 'Team rota' })).toBeChecked();
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Team rota' }));
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Family' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(server.sent('PATCH')[0]?.body).toEqual({
      calendars: [
        { id: 'cal-rota', shown: false },
        { id: 'cal-family', shown: true },
      ],
    });
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();
  });

  it('reads the list again when sync changes one of these calendars', async () => {
    const server = serve();
    show();
    await item('School');
    await act(() => live.open());
    const before = server.gets();
    await act(async () => {
      live.send({ type: 'calendar.changed', data: { eventId: 'evt-1' } });
      live.send({ type: 'calendar.changed', data: { layerId: 'my-events' } });
    });
    expect(server.gets()).toBe(before);
    await act(async () => {
      live.send({ type: 'calendar.changed', data: { layerId: 'connected:cal-school' } });
    });
    await waitFor(() => expect(server.gets()).toBe(before + 1));
  });

  it("says when the list didn't load, and tries again", async () => {
    const server = serve();
    server.down = true;
    show();
    expect(await screen.findByText(/^Your connected calendars didn't load\./)).toBeInTheDocument();
    server.down = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('listitem', { name: 'School' })).toBeInTheDocument();
  });
});
