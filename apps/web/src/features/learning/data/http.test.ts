import { ApiIssueSchema } from '@carehub/learning';
import { CSRF_COOKIE, CSRF_HEADER } from '@carehub/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { api, apiPath, csrfTokenFrom, LearningApiError, noContent, withQuery } from './http';

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
      value: { cookie: value === null ? '' : `other=1; ${CSRF_COOKIE}=${value}` },
      configurable: true,
      writable: true,
    });
  } else if (value === null) {
    document.cookie = `${CSRF_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  } else {
    document.cookie = `${CSRF_COOKIE}=${value}; path=/`;
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
      [CSRF_HEADER]: 'token-123',
    });
  });

  it('never sends the CSRF header with a GET', async () => {
    setCsrfCookie('token-123');
    reply(() => json({ path: '', message: '' }));
    await api('GET', '/me', ApiIssueSchema);
    expect(calls[0]?.init.headers).toEqual({ Accept: 'application/json' });
  });

  it('adds the headers it is given, but keeps its own', async () => {
    setCsrfCookie('token-123');
    reply(() => json({ path: '', message: 'Sent' }, 201));
    const headers = {
      'X-Review-Token': 'review-token',
      Accept: 'text/csv',
      [CSRF_HEADER]: 'forged',
    };
    await api('POST', '/review/comments', { body: 'Fine.' }, ApiIssueSchema, { headers });
    expect(calls[0]?.init.headers).toEqual({
      'X-Review-Token': 'review-token',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'token-123',
    });
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

  it('refuses paths that could reach another endpoint, without calling the server', async () => {
    setCsrfCookie('token-123');
    reply(() => json({ path: '', message: '' }));
    for (const path of [
      '/courses/..',
      '/courses/../studio/courses',
      '/courses/%2e%2e/progress',
      '/courses/%2E/progress',
      '/courses/.%2e',
      '/courses//progress',
      '/courses/',
      '/courses/c1%2Fprogress',
      '/courses/c1%5Cprogress',
      '/courses\\..\\me',
      '/courses/c1#progress',
      '/courses/%zz',
    ]) {
      expect(await failure(api('POST', path, {}, ApiIssueSchema))).toBeInstanceOf(TypeError);
    }
    expect(calls).toHaveLength(0);
  });

  it('takes encoded parts and leaves the query alone', async () => {
    reply(() => json({ path: '', message: '' }));
    await api('GET', `${apiPath('courses', 'c 1', 'progress')}?from=../x`, ApiIssueSchema);
    await api('GET', withQuery('/catalog', { q: '../..' }), ApiIssueSchema);
    expect(calls.map((call) => call.url)).toEqual([
      '/api/learning/courses/c%201/progress?from=../x',
      '/api/learning/catalog?q=..%2F..',
    ]);
  });

  it('builds query strings from the values that are set', () => {
    expect(
      withQuery('/catalog', { q: 'fire & safety', topic: undefined, page: 2, empty: '' }),
    ).toBe('/catalog?q=fire+%26+safety&page=2');
    expect(withQuery('/catalog', { q: null })).toBe('/catalog');
  });
});

describe('apiPath', () => {
  it('joins the parts and encodes each one', () => {
    expect(apiPath('studio', 'courses', 'c1', 'publish')).toBe('/studio/courses/c1/publish');
    expect(apiPath('courses', 'a b&c?d#e%', 'progress')).toBe(
      '/courses/a%20b%26c%3Fd%23e%25/progress',
    );
    expect(apiPath('studio', 'courses', 'c1', 'versions', 3)).toBe('/studio/courses/c1/versions/3');
  });

  it('refuses empty parts, dots (also encoded) and slashes inside a part', () => {
    for (const part of ['', '.', '..', '%2e', '%2E%2e', '.%2e', 'a/b', 'a\\b', '%2F', '%5c']) {
      expect(() => apiPath('courses', part, 'progress')).toThrow(TypeError);
    }
    expect(() => apiPath()).toThrow(TypeError);
  });
});

describe('csrfTokenFrom', () => {
  it("reads core's HTTPS cookie first, then the plain one", () => {
    expect(csrfTokenFrom(`a=1; __Host-${CSRF_COOKIE}=t%2B1; ${CSRF_COOKIE}=old`)).toBe('t+1');
    expect(csrfTokenFrom(`a=1; ${CSRF_COOKIE}=plain`)).toBe('plain');
  });

  it('finds nothing without either cookie', () => {
    expect(csrfTokenFrom('')).toBeUndefined();
    expect(csrfTokenFrom(`${CSRF_COOKIE}_old=1; x=${CSRF_COOKIE}`)).toBeUndefined();
  });
});
