import { CSRF_COOKIE } from '@carehub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api, ApiError } from './api';

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function lastRequest() {
  const [path, init = {}] = fetchMock.mock.calls.at(-1) ?? [];
  return { path, init, headers: new Headers(init.headers) };
}

async function failure(call: Promise<unknown>): Promise<ApiError> {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  document.cookie = `${CSRF_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
});

describe('api', () => {
  it('gets JSON with the session cookie and no CSRF header', async () => {
    document.cookie = `${CSRF_COOKIE}=token-1; path=/`;
    fetchMock.mockResolvedValue(json(200, { id: 'page-1' }));

    await expect(api.get('/api/pages/page-1')).resolves.toEqual({ id: 'page-1' });
    const { path, init, headers } = lastRequest();
    expect(path).toBe('/api/pages/page-1');
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', body: undefined });
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.has('X-CSRF-Token')).toBe(false);
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('sends a JSON body and the CSRF token from the CSRF cookie', async () => {
    document.cookie = 'other=1; path=/';
    document.cookie = `${CSRF_COOKIE}=abc%2Fdef%3D%3D; path=/`;
    fetchMock.mockResolvedValue(json(201, { id: 'page-2' }));

    await expect(api.post('/api/pages', { title: 'Shift notes' })).resolves.toEqual({
      id: 'page-2',
    });
    const { init, headers } = lastRequest();
    expect(init).toMatchObject({ method: 'POST', body: '{"title":"Shift notes"}' });
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-CSRF-Token')).toBe('abc/def==');
  });

  it('uses the right method for put, patch and delete, and returns undefined without a body', async () => {
    document.cookie = `${CSRF_COOKIE}=token-1; path=/`;
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));

    await expect(api.put('/api/favorites', ['page-1'])).resolves.toBeUndefined();
    expect(lastRequest().init.method).toBe('PUT');
    await expect(api.patch('/api/pages/page-1', { title: 'Handover' })).resolves.toBeUndefined();
    expect(lastRequest().init.method).toBe('PATCH');
    await expect(api.delete('/api/pages/page-1')).resolves.toBeUndefined();
    const { init, headers } = lastRequest();
    expect(init).toMatchObject({ method: 'DELETE', body: undefined });
    expect(headers.get('X-CSRF-Token')).toBe('token-1');
  });

  it('sends a CSRF cookie with broken percent-encoding as it is', async () => {
    document.cookie = `${CSRF_COOKIE}=abc%E0%A4%A; path=/`;
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));

    await api.post('/api/pages/page-1/restore');
    expect(lastRequest().headers.get('X-CSRF-Token')).toBe('abc%E0%A4%A');
  });

  it('sends only to /api/ paths on this site', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    const paths = [
      'https://other.example/api/pages',
      '//other.example/api/pages',
      '/apix/pages',
      'api/pages',
      '/api',
      '/',
    ];
    for (const path of paths) await expect(api.get(path)).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses "." and ".." segments, also encoded or hidden', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    const paths = [
      '/api/pages/../admin/users',
      '/api/pages/%2E%2e/admin/users',
      '/api/pages/.%2e',
      '/api/./pages',
      '/api/pages/..\\admin',
      '/api/pages/.\t./admin',
      '/api/pages/..\u0001',
    ];
    for (const path of paths) await expect(api.delete(path)).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();

    await api.get('/api/search?q=../notes');
    await api.get('/api/files/notes..v2');
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/search?q=../notes',
      '/api/files/notes..v2',
    ]);
  });

  it('turns an error body into an ApiError', async () => {
    const message = 'This was deleted, or the link is wrong.';
    fetchMock.mockResolvedValue(json(404, { error: { code: 'not_found', message } }));

    const error = await failure(api.get('/api/pages/gone'));
    expect(error).toMatchObject({ name: 'ApiError', status: 404, code: 'not_found', message });
  });

  it('keeps the details of an invalid request', async () => {
    const details = [{ path: ['title'], message: 'Too long' }];
    fetchMock.mockResolvedValue(
      json(400, { error: { code: 'invalid', message: 'Check the title.', details } }),
    );

    const error = await failure(api.post('/api/pages', { title: 'x'.repeat(500) }));
    expect(error).toMatchObject({ status: 400, code: 'invalid', details });
  });

  it('gives a plain error when the response has no error body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<h1>Forbidden</h1>', { status: 403 }));
    expect(await failure(api.get('/api/admin'))).toMatchObject({
      status: 403,
      code: 'forbidden',
      message: 'Something went wrong. Try again.',
    });

    fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }));
    expect(await failure(api.get('/api/pages'))).toMatchObject({ status: 502, code: 'unexpected' });
  });

  it('reports a network failure as offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await failure(api.get('/api/pages'))).toMatchObject({
      status: 0,
      code: 'offline',
      message: "Can't reach Care Hub. Check your connection, then try again.",
    });
  });

  it('passes on an abort instead of reporting offline', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValue(abort);

    await expect(api.get('/api/search', { signal: controller.signal })).rejects.toBe(abort);
    expect(lastRequest().init.signal).toBe(controller.signal);
  });

  it('checks and converts the response with a schema', async () => {
    const schema = z.object({ id: z.string(), updatedAt: z.coerce.date() });
    fetchMock.mockResolvedValue(json(200, { id: 'page-1', updatedAt: '2026-10-27T15:00:00.000Z' }));

    const page = await api.get('/api/pages/page-1', { schema });
    expect(page.updatedAt).toEqual(new Date('2026-10-27T15:00:00.000Z'));

    fetchMock.mockResolvedValue(json(200, { id: 42 }));
    const error = await failure(api.patch('/api/pages/page-1', { title: 'New' }, { schema }));
    expect(error).toMatchObject({ status: 200, code: 'invalid_response' });
    expect(error.details).toEqual(expect.any(Array));
  });
});
