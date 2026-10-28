// Test helpers: Home's data behind a fake `fetch`.
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
    /** How many requests fail before they work again. */
    fail: 0,
    /** Leave requests unanswered. */
    hold: false,
    calls: [] as string[],
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const fetchStub = (async (input: string | URL | Request) => {
    const url = String(input);
    server.calls.push(url);
    if (server.hold) return new Promise<Response>(() => {});
    if (server.fail > 0) {
      server.fail -= 1;
      return json(500, { error: { code: 'internal', message: 'The server broke.' } });
    }
    if (url.startsWith('/api/calendar/upcoming?')) return json(200, { items: server.upcoming });
    return json(404, { error: { code: 'not_found', message: 'Not found.' } });
  }) as typeof fetch;
  return { server, fetchStub };
}
