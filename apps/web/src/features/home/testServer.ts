// Test helpers: Home's data behind a fake `fetch`.
import type { HomeSettings } from './settings';
import type { UpcomingItem } from './upcoming';

export function upcomingItem(overrides: Partial<UpcomingItem> = {}): UpcomingItem {
  return {
    id: 'e1',
    title: 'Care team huddle',
    allDay: false,
    start: '2026-10-27T17:45:00.000Z',
    end: '2026-10-27T18:15:00.000Z',
    videoLink: null,
    href: '/calendar?event=e1',
    ...overrides,
  };
}

/** Answers Home's requests from `server`, the way the server does. */
export function createHomeServer() {
  const server = {
    upcoming: [] as UpcomingItem[],
    settings: { hiddenSections: [], upcomingFolded: false } as HomeSettings,
    /** How many Upcoming requests fail before they work again. */
    fail: 0,
    /** How many settings changes fail before they work again. */
    failChanges: 0,
    /** Leave Upcoming requests unanswered. */
    hold: false,
    /** Every request: the path for a GET, else the method and the path. */
    calls: [] as string[],
    /** The bodies of the settings changes. */
    changes: [] as unknown[],
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const broken = () => json(500, { error: { code: 'internal', message: 'The server broke.' } });
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    server.calls.push(method === 'GET' ? url : `${method} ${url}`);
    if (url === '/api/home/settings') {
      if (method === 'GET') return json(200, { settings: server.settings });
      const change = JSON.parse(String(init?.body)) as Partial<HomeSettings>;
      server.changes.push(change);
      if (server.failChanges > 0) {
        server.failChanges -= 1;
        return broken();
      }
      server.settings = { ...server.settings, ...change };
      return json(200, { settings: server.settings });
    }
    if (server.hold) return new Promise<Response>(() => {});
    if (server.fail > 0) {
      server.fail -= 1;
      return broken();
    }
    if (url.startsWith('/api/calendar/upcoming?')) return json(200, { items: server.upcoming });
    return json(404, { error: { code: 'not_found', message: 'Not found.' } });
  }) as typeof fetch;
  /** The requests for `path` only. */
  const callsTo = (path: string) => server.calls.filter((call) => call.includes(path));
  return { server, fetchStub, callsTo };
}
