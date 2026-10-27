// Test helper: a LiveClient wired to a fake EventSource and a fake topics endpoint.
import { LiveClient, type LiveClientOptions, type LiveEvent, type LiveSource } from './client';

export class FakeSource implements LiveSource {
  closed = false;
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: object): void {
    const event = { data: data === undefined ? undefined : JSON.stringify(data) };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

export interface TopicsRequest {
  url: string;
  headers: Record<string, string>;
  body: { connectionId: string; add: string[]; remove: string[] };
  respond(status: number, results?: { topic: string; ok: boolean }[]): void;
}

/** Lets pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

export interface FakeLiveOptions extends LiveClientOptions {
  /** Leave topic requests unanswered until the test calls `respond`. */
  manual?: boolean;
  /** Topics the fake server refuses. */
  refuse?: readonly string[];
}

export function createFakeLive(options: FakeLiveOptions = {}) {
  const sources: FakeSource[] = [];
  const urls: string[] = [];
  const requests: TopicsRequest[] = [];
  /** The topics the fake server holds for the current connection. */
  const subscribed = new Set<string>();
  const refused = new Set(options.refuse ?? []);
  let wake = () => {};

  const client = new LiveClient({
    createSource: (url) => {
      urls.push(url);
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    fetch: (url, init) =>
      new Promise((resolve) => {
        const body = JSON.parse(init.body) as TopicsRequest['body'];
        const request: TopicsRequest = {
          url,
          headers: init.headers,
          body,
          respond: (status, results) => {
            for (const result of results ?? []) {
              if (body.remove.includes(result.topic)) subscribed.delete(result.topic);
              else if (result.ok) subscribed.add(result.topic);
            }
            resolve({ ok: status < 300, status, json: async () => ({ results }) });
          },
        };
        requests.push(request);
        if (options.manual) return;
        request.respond(200, [
          ...body.remove.map((topic) => ({ topic, ok: true })),
          ...body.add.map((topic) => ({ topic, ok: !refused.has(topic) })),
        ]);
      }),
    onWake: (callback) => {
      wake = callback;
      return () => {
        wake = () => {};
      };
    },
    random: () => 0,
    ...options,
  });

  const last = () => {
    const source = sources.at(-1);
    if (!source) throw new Error('No EventSource was opened.');
    return source;
  };

  return {
    client,
    sources,
    urls,
    requests,
    subscribed,
    last,
    wake: () => wake(),
    /** Sends `hello` on the newest stream and lets the topic requests finish. */
    async open(connectionId = `conn-${sources.length}`) {
      subscribed.clear();
      last().emit('hello', { connectionId, heartbeatMs: 25_000 });
      await flush();
    },
    /** Sends an app event on the newest stream (a topic event when `topic` is given). */
    send(event: LiveEvent, topic?: string) {
      last().emit('message', topic === undefined ? event : { topic, ...event });
    },
  };
}
