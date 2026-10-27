import { ApiIssueSchema } from '@carehub/learning';
import { afterEach, describe, expect, it } from 'vitest';
import { api, LearningApiError, noContent, withQuery } from './http';

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

function useFetch(value: unknown) {
  Object.defineProperty(globalThis, 'fetch', { value, configurable: true, writable: true });
}

function reply(handler: (call: Call) => Response | Promise<Response>) {
  calls = [];
  useFetch(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setCsrfCookie(value: string | null) {
  if (typeof document === 'undefined') {
    Object.defineProperty(globalThis, 'document', {
      value: { cookie: value === null ? '' : `other=1; carehub_csrf=${value}` },
      configurable: true,
      writable: true,
    });
  } else if (value === null) {
    document.cookie = 'carehub_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  } else {
    document.cookie = `carehub_csrf=${value}; path=/`;
  }
}

async function failure(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

afterEach(() => {
  useFetch(realFetch);
  setCsrfCookie(null);
});

describe('Learning API client', () => {
  it('gets from /api/learning and checks the reply with the schema', async () => {
    reply(() => json({ path: 'title', message: 'Hi' }));
    await expect(api('GET', '/catalog', ApiIssueSchema)).resolves.toEqual({
      path: 'title',
      message: 'Hi',
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('/api/learning/catalog');
    expect(call?.init.method).toBe('GET');
    expect(call?.init.body).toBeUndefined();
    expect(call?.init.credentials).toBe('same-origin');
    expect(call?.init.headers).toEqual({ Accept: 'application/json' });
  });

  it('sends a JSON body and the CSRF header with changes', async () => {
    setCsrfCookie('token-123');
    reply(() => json({ path: '', message: 'Saved' }, 201));
    await api('POST', '/studio/courses', { type: 'standard' }, ApiIssueSchema);
    expect(calls[0]?.init.body).toBe('{"type":"standard"}');
    expect(calls[0]?.init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'token-123',
    });
  });

  it('never sends the CSRF header with a GET', async () => {
    setCsrfCookie('token-123');
    reply(() => json({ path: '', message: '' }));
    await api('GET', '/me', ApiIssueSchema);
    expect(calls[0]?.init.headers).toEqual({ Accept: 'application/json' });
  });

  it("throws the server's code, message and issues", async () => {
    const issues = [{ path: 'title', message: 'Add a title.' }];
    reply(() => json({ error: { code: 'invalid', message: 'Check the title.', issues } }, 400));
    const error = await failure(api('PUT', '/studio/courses/c1', {}, ApiIssueSchema));
    expect(error).toBeInstanceOf(LearningApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'invalid',
      message: 'Check the title.',
      issues,
    });
  });

  it('uses the plain message for the status when the error has no readable body', async () => {
    reply(() => new Response('<html>Forbidden</html>', { status: 403 }));
    const error = await failure(api('GET', '/studio/courses', ApiIssueSchema));
    expect(error).toMatchObject({
      status: 403,
      code: 'forbidden',
      message: "You don't have access to this.",
      issues: [],
    });
  });

  it('says so when Care Hub cannot be reached', async () => {
    reply(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await failure(api('GET', '/me', ApiIssueSchema));
    expect(error).toBeInstanceOf(LearningApiError);
    expect(error).toMatchObject({ status: 0, code: 'offline' });
    expect((error as LearningApiError).offline).toBe(true);
  });

  it('lets an aborted call reject with the abort itself', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    reply(() => Promise.reject(abort));
    const error = await failure(api('GET', '/me', ApiIssueSchema, { signal: controller.signal }));
    expect(error).toBe(abort);
  });

  it("refuses a reply that doesn't match the schema", async () => {
    reply(() => json({ unexpected: true }));
    const error = await failure(api('GET', '/me', ApiIssueSchema));
    expect(error).toMatchObject({ status: 200, code: 'unreadable_reply' });
  });

  it('accepts an empty reply with noContent', async () => {
    reply(() => new Response(null, { status: 204 }));
    await expect(api('DELETE', '/studio/block-templates/t1', noContent)).resolves.toBeUndefined();
    expect(calls[0]?.init.method).toBe('DELETE');
  });

  it('only takes paths that start with a slash', async () => {
    reply(() => json({}));
    const error = await failure(api('GET', 'catalog', ApiIssueSchema));
    expect(error).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(0);
  });

  it('builds query strings from the values that are set', () => {
    expect(
      withQuery('/catalog', { q: 'fire & safety', topic: undefined, page: 2, empty: '' }),
    ).toBe('/catalog?q=fire+%26+safety&page=2');
    expect(withQuery('/catalog', { q: null })).toBe('/catalog');
  });
});
