// Care Hub's API for the assistant panel's tests: each route answers at once, or holds its answer
// until the test gives it (and fails like fetch does once its request is stopped).
import { act } from '@testing-library/react';

export interface Sent {
  method: string;
  path: string;
  body: unknown;
  signal: AbortSignal | null;
}

export interface Reply {
  status: number;
  body?: unknown;
}

/** A request whose answer waits for the test. */
export interface Held {
  sent: Sent;
  reply: (reply: Reply) => Promise<void>;
}

export type Route = Reply | 'hold' | ((sent: Sent) => Reply | 'hold');

export const NOT_FOUND: Reply = {
  status: 404,
  body: { error: { code: 'not_found', message: 'Not found.' } },
};

const toResponse = ({ status, body }: Reply) =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body ?? {}), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

/** Routes are keyed "METHOD /path", e.g. "GET /api/claude/assistant/chats". */
export function fakeApi(routes: Record<string, Route> = {}) {
  const sent: Sent[] = [];
  const held: Held[] = [];

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const one: Sent = {
      method: init?.method ?? 'GET',
      path: String(input),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      signal: init?.signal ?? null,
    };
    sent.push(one);
    const route = routes[`${one.method} ${one.path}`] ?? NOT_FOUND;
    const answer = typeof route === 'function' ? route(one) : route;
    if (answer !== 'hold') return toResponse(answer);
    return new Promise<Response>((resolve, reject) => {
      one.signal?.addEventListener('abort', () =>
        reject(new DOMException('Stopped', 'AbortError')),
      );
      held.push({ sent: one, reply: (reply) => act(async () => resolve(toResponse(reply))) });
    });
  }) as typeof globalThis.fetch;

  return {
    fetch,
    routes,
    sent,
    held,
    /** The requests sent to one route, oldest first. */
    to: (key: string) => sent.filter((one) => `${one.method} ${one.path}` === key),
  };
}
