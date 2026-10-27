import { readCsrfToken as readCsrfCookie } from '@carehub/shared';

/** Same shape as the server's: a nudge with ids only. Refetch through the normal APIs. */
export type LiveEvent = { type: string; data?: Record<string, unknown> };
export type LiveHandler = (event: LiveEvent) => void;

/** The parts of `EventSource` the client uses. */
export interface LiveSource {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
}

export type LiveFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    credentials: 'same-origin';
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface LiveClientOptions {
  url?: string;
  topicsUrl?: string;
  /** Null where there's no EventSource (tests, server rendering): the client stays quiet. */
  createSource?: (url: string) => LiveSource | null;
  fetch?: LiveFetch;
  /** The CSRF token sent with topic changes. Defaults to the CSRF cookie (`readCsrfToken`). */
  csrfToken?: () => string;
  /** Calls `wake` when the tab is used again; returns a clean-up. */
  onWake?: (wake: () => void) => () => void;
  random?: () => number;
  now?: () => number;
  /** How long the stream stays open after the last handler leaves. */
  lingerMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

/** `parked`: the server closed this tab for a newer one; it reconnects when the tab is used. */
export type LiveState = 'idle' | 'connecting' | 'open' | 'waiting' | 'parked' | 'unsupported';

const MAX_TOPICS_PER_REQUEST = 50;
const MAX_TOPIC_LENGTH = 200;

/**
 * The readable CSRF cookie, which state-changing requests send as `X-CSRF-Token`:
 * `__Host-carehub_csrf` over HTTPS, `carehub_csrf` on a plain-HTTP development server.
 */
export function readCsrfToken(
  cookie: string = typeof document === 'undefined' ? '' : document.cookie,
): string {
  const value = readCsrfCookie(cookie) ?? '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Calls `wake` on focus, when the tab becomes visible and when the network comes back. */
function listenForWake(wake: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const onVisible = () => {
    if (document.visibilityState === 'visible') wake();
  };
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wake);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

const defaults: Required<LiveClientOptions> = {
  url: '/api/live',
  topicsUrl: '/api/live/topics',
  createSource: (url) => (typeof EventSource === 'undefined' ? null : new EventSource(url)),
  fetch: (url, init) => fetch(url, init),
  csrfToken: () => readCsrfToken(),
  onWake: listenForWake,
  random: () => Math.random(),
  now: () => Date.now(),
  lingerMs: 10_000,
  minDelayMs: 1_000,
  maxDelayMs: 30_000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function call(handler: LiveHandler, event: LiveEvent): void {
  try {
    handler(event);
  } catch (error) {
    console.error('live: an event handler failed', error);
  }
}

/**
 * One EventSource per tab, opened when the first handler subscribes. It reconnects with backoff
 * and jitter, subscribes the tab's topics again and then sends `live-reconnected` to every
 * handler, because events may have been missed in between.
 */
export class LiveClient {
  private readonly options: Required<LiveClientOptions>;
  private readonly types = new Map<string, Set<LiveHandler>>();
  private readonly topics = new Map<string, Set<LiveHandler>>();
  /** Topics the server accepted for this connection, and those it refused. */
  private readonly confirmed = new Set<string>();
  private readonly refused = new Set<string>();
  private source: LiveSource | null = null;
  private status: LiveState = 'idle';
  private connectionId: string | null = null;
  private heartbeatMs = 25_000;
  private openedAt: number | null = null;
  private attempt = 0;
  private connectedBefore = false;
  private reconnectedDue = false;
  private syncing = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private lingerTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private stopWaking: (() => void) | null = null;

  constructor(options: LiveClientOptions = {}) {
    this.options = { ...defaults, ...options };
  }

  get state(): LiveState {
    return this.status;
  }

  /** Calls `handler` for per-user events of `type`. Returns the unsubscribe. */
  onEvent(type: string, handler: LiveHandler): () => void {
    return this.add(this.types, type, handler);
  }

  /** Subscribes the tab to `topic` and calls `handler` for its events. Returns the unsubscribe. */
  onTopic(topic: string, handler: LiveHandler): () => void {
    const off = this.add(this.topics, topic, handler);
    void this.sync();
    return () => {
      off();
      if (!this.topics.has(topic)) this.refused.delete(topic);
      void this.sync();
    };
  }

  /** Closes the stream. The next handler to subscribe opens a new one. */
  stop(): void {
    this.close();
    clearTimeout(this.retryTimer);
    clearTimeout(this.lingerTimer);
    this.stopWaking?.();
    this.stopWaking = null;
    this.status = 'idle';
    this.attempt = 0;
    this.connectedBefore = false;
    this.reconnectedDue = false;
  }

  private add(map: Map<string, Set<LiveHandler>>, key: string, handler: LiveHandler): () => void {
    // A wrapper per call, so the same function added twice is two subscriptions.
    const entry: LiveHandler = (event) => handler(event);
    const handlers = map.get(key) ?? new Set<LiveHandler>();
    handlers.add(entry);
    map.set(key, handlers);
    this.start();
    let added = true;
    return () => {
      if (!added) return;
      added = false;
      handlers.delete(entry);
      if (handlers.size === 0 && map.get(key) === handlers) map.delete(key);
      if (this.types.size === 0 && this.topics.size === 0) this.linger();
    };
  }

  private start(): void {
    clearTimeout(this.lingerTimer);
    if (this.status !== 'idle') return;
    this.stopWaking = this.options.onWake(() => this.wake());
    this.connect();
  }

  private linger(): void {
    clearTimeout(this.lingerTimer);
    this.lingerTimer = setTimeout(() => {
      if (this.types.size === 0 && this.topics.size === 0) this.stop();
    }, this.options.lingerMs);
  }

  private wake(): void {
    if (this.status === 'waiting' || this.status === 'parked') this.connect();
  }

  private connect(): void {
    clearTimeout(this.retryTimer);
    this.close();
    const source = this.options.createSource(this.options.url);
    if (!source) {
      this.status = 'unsupported';
      return;
    }
    this.source = source;
    this.status = 'connecting';
    this.openedAt = null;
    const on = (type: string, listener: (data: unknown) => void) => {
      source.addEventListener(type, (event) => {
        if (this.source !== source) return;
        this.watch();
        listener(event.data);
      });
    };
    on('hello', (data) => this.hello(data));
    on('message', (data) => this.dispatch(data));
    on('unsubscribed', (data) => this.withdrawn(data));
    on('bye', () => this.park());
    on('ping', () => {});
    source.addEventListener('error', () => {
      if (this.source === source) this.fail();
    });
    this.watch();
  }

  /** Ends the current connection, if any. */
  private close(): void {
    this.source?.close();
    this.source = null;
    this.connectionId = null;
    this.confirmed.clear();
    this.refused.clear();
    clearTimeout(this.watchdog);
  }

  /** No frame (heartbeats included) for two heartbeats means the stream is dead. */
  private watch(): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.fail(), 2 * this.heartbeatMs + 5_000);
  }

  private fail(): void {
    if (this.status !== 'connecting' && this.status !== 'open') return;
    const lived = this.openedAt === null ? 0 : this.options.now() - this.openedAt;
    if (lived >= this.options.maxDelayMs) this.attempt = 0;
    this.close();
    const { minDelayMs, maxDelayMs, random } = this.options;
    const delay = Math.min(maxDelayMs, minDelayMs * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 20);
    this.status = 'waiting';
    this.retryTimer = setTimeout(() => this.connect(), delay / 2 + (delay / 2) * random());
  }

  private park(): void {
    this.close();
    this.status = 'parked';
  }

  private hello(data: unknown): void {
    const hello = parse(data);
    if (typeof hello?.connectionId !== 'string' || hello.connectionId === '') {
      this.fail();
      return;
    }
    if (typeof hello.heartbeatMs === 'number' && hello.heartbeatMs >= 1_000) {
      this.heartbeatMs = hello.heartbeatMs;
    }
    this.connectionId = hello.connectionId;
    this.status = 'open';
    this.openedAt = this.options.now();
    this.confirmed.clear();
    this.refused.clear();
    if (this.connectedBefore) this.reconnectedDue = true;
    this.connectedBefore = true;
    this.watch();
    void this.sync();
  }

  private dispatch(data: unknown): void {
    const message = parse(data);
    if (typeof message?.type !== 'string') return;
    const event: LiveEvent = isRecord(message.data)
      ? { type: message.type, data: message.data }
      : { type: message.type };
    const handlers =
      typeof message.topic === 'string'
        ? this.topics.get(message.topic)
        : this.types.get(message.type);
    for (const handler of [...(handlers ?? [])]) call(handler, event);
  }

  private withdrawn(data: unknown): void {
    const topic = parse(data)?.topic;
    if (typeof topic !== 'string') return;
    this.confirmed.delete(topic);
    this.refused.add(topic);
  }

  /** Sends `live-reconnected` to every handler, once the topics are subscribed again. */
  private broadcast(): void {
    const handlers = [...this.types.values(), ...this.topics.values()].flatMap((set) => [...set]);
    for (const handler of handlers) call(handler, { type: 'live-reconnected' });
  }

  /** Brings the server's topics in line with the handlers, one request at a time. */
  private async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      while (this.connectionId !== null) {
        const connectionId = this.connectionId;
        const add: string[] = [];
        for (const topic of this.topics.keys()) {
          if (this.confirmed.has(topic) || this.refused.has(topic)) continue;
          if (topic.length > MAX_TOPIC_LENGTH) this.refused.add(topic);
          else if (add.length < MAX_TOPICS_PER_REQUEST) add.push(topic);
        }
        const remove = [...this.confirmed]
          .filter((topic) => !this.topics.has(topic))
          .slice(0, MAX_TOPICS_PER_REQUEST);
        if (add.length === 0 && remove.length === 0) {
          if (this.reconnectedDue) {
            this.reconnectedDue = false;
            this.broadcast();
          }
          return;
        }
        for (const topic of remove) this.confirmed.delete(topic);
        const accepted = await this.post(connectionId, add, remove);
        if (this.connectionId !== connectionId) continue;
        if (!accepted) {
          this.fail();
          return;
        }
        for (const topic of add) (accepted.has(topic) ? this.confirmed : this.refused).add(topic);
      }
    } finally {
      this.syncing = false;
    }
  }

  /** The topics the server accepted, or null when the connection should start over. */
  private async post(connectionId: string, add: string[], remove: string[]) {
    try {
      const token = this.options.csrfToken();
      const response = await this.options.fetch(this.options.topicsUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-csrf-token': token } : {}),
        },
        body: JSON.stringify({ connectionId, add, remove }),
        credentials: 'same-origin',
      });
      if (response.status === 400) return new Set<string>();
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const accepted = new Set<string>();
      const results: unknown = isRecord(body) ? body.results : null;
      for (const result of Array.isArray(results) ? (results as unknown[]) : []) {
        if (isRecord(result) && result.ok === true && typeof result.topic === 'string') {
          accepted.add(result.topic);
        }
      }
      return accepted;
    } catch {
      return null;
    }
  }
}

let shared: LiveClient | null = null;

/** The tab's client. */
export function getLiveClient(): LiveClient {
  shared ??= new LiveClient();
  return shared;
}

/** Swaps the tab's client in tests; null goes back to the default. */
export function setLiveClientForTest(client: LiveClient | null): void {
  shared?.stop();
  shared = client;
}
