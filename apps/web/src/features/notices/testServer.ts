// Test helpers: a fake /api/notices behind `fetch`, and a fake IntersectionObserver.
import type { NoticeKind, NoticeView } from './api';

export function notice(overrides: Partial<NoticeView> = {}): NoticeView {
  return {
    id: 'n1',
    position: 1,
    kind: 'reminder',
    sender: 'Reminders',
    actorUserId: null,
    icon: null,
    title: 'Reminder',
    text: null,
    card: null,
    buttons: [],
    count: 1,
    createdAt: '2026-10-27T15:00:00.000Z',
    latestAt: '2026-10-27T15:00:00.000Z',
    read: false,
    ...overrides,
  };
}

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

const FILTER_KINDS: Record<string, readonly NoticeKind[] | null> = {
  all: null,
  mentions: ['mention', 'reply', 'suggestion_accepted', 'suggestion_rejected'],
  following: ['comment', 'suggestion', 'edit_summary'],
  reminders: ['reminder'],
  requests: ['access_request'],
  unread: null,
};

/** Answers the notices API from `notices` (oldest first), the way the server does. */
export function createNoticesServer(initial: NoticeView[]) {
  const server = {
    notices: initial,
    /** Notices per page, whatever the request asks for. */
    pageSize: 50,
    /** How many chat requests fail before they work again. */
    failLists: 0,
    /** Leave chat requests unanswered. */
    holdLists: false,
    calls: [] as Call[],
    posts: () => server.calls.filter((c) => c.method === 'POST').map((c) => [c.url, c.body]),
    add(added: NoticeView) {
      server.notices = [...server.notices, added];
    },
  };
  const unread = () => server.notices.filter((n) => !n.read).length;
  const markRead = (matches: (n: NoticeView) => boolean) => {
    server.notices = server.notices.map((n) => (matches(n) ? { ...n, read: true } : n));
  };

  const answer = (call: Call): { status: number; body: unknown } | null => {
    const url = new URL(call.url, 'http://localhost');
    const ok = (body: unknown) => ({ status: 200, body });
    if (call.method === 'GET' && url.pathname === '/api/notices/summary') {
      const latest = server.notices.at(-1);
      return ok({
        unread: unread(),
        latest: latest
          ? { title: latest.title, sender: latest.sender, latestAt: latest.latestAt }
          : null,
      });
    }
    if (call.method === 'GET' && url.pathname === '/api/notices') {
      if (server.holdLists) return null;
      if (server.failLists > 0) {
        server.failLists -= 1;
        return {
          status: 500,
          body: { error: { code: 'unexpected', message: 'The server broke.' } },
        };
      }
      const filter = url.searchParams.get('filter') ?? 'all';
      const before = Number(url.searchParams.get('before') ?? Infinity);
      const kinds = FILTER_KINDS[filter] ?? null;
      const matching = [...server.notices]
        .reverse()
        .filter((n) => n.position < before)
        .filter((n) => (filter === 'unread' ? !n.read : !kinds || kinds.includes(n.kind)));
      const page = matching.slice(0, server.pageSize);
      return ok({
        notices: page,
        nextCursor: matching.length > page.length ? (page.at(-1)?.position ?? null) : null,
        unread: unread(),
      });
    }
    if (call.method === 'POST' && url.pathname === '/api/notices/read') {
      const { through } = call.body as { through: number };
      markRead((n) => n.position <= through);
      return ok({ unread: unread() });
    }
    if (call.method === 'POST' && url.pathname === '/api/notices/read-all') {
      markRead(() => true);
      return ok({ unread: unread() });
    }
    const one = /^\/api\/notices\/([^/]+)\/(read|actions)$/.exec(url.pathname);
    if (call.method === 'POST' && one) {
      markRead((n) => n.id === one[1]);
      if (one[2] === 'read') return ok({ unread: unread() });
      const { choice } = call.body as { button: number; choice?: number };
      return ok({
        message: choice === undefined ? 'Marked done' : 'Snoozed for 1 hour',
        unread: unread(),
      });
    }
    return { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } };
  };

  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body };
    server.calls.push(call);
    const result = answer(call);
    if (!result) return new Promise<Response>(() => {});
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return { server, fetchStub };
}

/** Stands in for IntersectionObserver; `showEdge` says what's in view. */
export class FakeIntersectionObserver {
  static readonly instances = new Set<FakeIntersectionObserver>();
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: number[] = [];
  readonly targets = new Set<Element>();
  readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.add(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    FakeIntersectionObserver.instances.delete(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Tells the chat its top or bottom edge came into view (or left it). */
export function showEdge(edge: 'top' | 'bottom', isIntersecting = true): void {
  const target = document.querySelector(`[data-edge="${edge}"]`);
  if (!target) throw new Error(`The chat has no ${edge} edge.`);
  const entry = { target, isIntersecting } as unknown as IntersectionObserverEntry;
  for (const observer of FakeIntersectionObserver.instances) {
    if (observer.targets.has(target)) {
      observer.callback([entry], observer as unknown as IntersectionObserver);
    }
  }
}

/** Item `index`, or a clear failure. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`There's no item ${index}.`);
  return item;
}
