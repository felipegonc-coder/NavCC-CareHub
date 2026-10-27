import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createDatabaseClient,
  fetchJson,
  isApiError,
  OFFLINE_MESSAGE,
  UNKNOWN_ERROR_MESSAGE,
  type HttpMethod,
} from './api';

function recorder(answer: unknown = { ok: true }) {
  const calls: { method: HttpMethod; path: string; body: unknown }[] = [];
  const request = <T>(method: HttpMethod, path: string, body?: unknown): Promise<T> => {
    calls.push({ method, path, body });
    return Promise.resolve(answer as T);
  };
  return { calls, client: createDatabaseClient(request) };
}

function response(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

describe('createDatabaseClient', () => {
  it('sends each route to its path with its body', async () => {
    const { calls, client } = recorder();
    await client.getDatabase('db 1');
    await client.updateDatabase('db1', 7, { locked: true });
    await client.query('db1', { viewId: 'v1', override: null, search: '' });
    await client.query('db1', { viewId: 'v1', search: 'sink', cursor: 'c2' });
    await client.createRow('db1', { viewId: 'v1', groupKey: 'g1' });
    await client.updateRow('db1', 'r1', { p1: null });
    await client.trashRows('db1', ['r1', 'r2']);
    await client.moveRow('db1', 'v1', 'r1');
    await client.moveRow('db1', 'v1', 'r1', 'r2');
    await client.pickRows('db1', 'sink & drain');
    await client.applyTemplate('db1', 't1', 'r1', true);
    await client.setAccessRules('db1', [{ id: 'a1', propertyId: 'p1', level: 'edit' }]);
    await client.exportCsv('db1', { scope: 'all' });
    await client.orderViews('db1', ['v2', 'v1']);
    await client.submitForm('code1', { q1: 'Yes' });
    await client.changeFormLink('db1', 'v2');

    expect(calls).toEqual([
      { method: 'GET', path: '/api/databases/db%201', body: undefined },
      { method: 'PATCH', path: '/api/databases/db1', body: { locked: true, version: 7 } },
      { method: 'POST', path: '/api/databases/db1/query', body: { viewId: 'v1' } },
      {
        method: 'POST',
        path: '/api/databases/db1/query',
        body: { viewId: 'v1', search: 'sink', cursor: 'c2' },
      },
      { method: 'POST', path: '/api/databases/db1/rows', body: { viewId: 'v1', groupKey: 'g1' } },
      { method: 'PATCH', path: '/api/databases/db1/rows/r1', body: { values: { p1: null } } },
      { method: 'POST', path: '/api/databases/db1/rows/trash', body: { rowIds: ['r1', 'r2'] } },
      { method: 'PUT', path: '/api/databases/db1/views/v1/order', body: { rowId: 'r1' } },
      {
        method: 'PUT',
        path: '/api/databases/db1/views/v1/order',
        body: { rowId: 'r1', beforeRowId: 'r2' },
      },
      { method: 'GET', path: '/api/databases/db1/rows/pick?q=sink%20%26%20drain', body: undefined },
      {
        method: 'POST',
        path: '/api/databases/db1/templates/t1/apply',
        body: { rowId: 'r1', replace: true },
      },
      {
        method: 'PUT',
        path: '/api/databases/db1/access-rules',
        body: [{ id: 'a1', propertyId: 'p1', level: 'edit' }],
      },
      { method: 'POST', path: '/api/databases/db1/export', body: { scope: 'all' } },
      { method: 'PUT', path: '/api/databases/db1/views/order', body: { viewIds: ['v2', 'v1'] } },
      { method: 'POST', path: '/api/forms/code1/responses', body: { answers: { q1: 'Yes' } } },
      { method: 'POST', path: '/api/forms/db1/views/v2/link', body: undefined },
    ]);
  });
});

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends JSON with cookies and reads the answer', async () => {
    const fetchMock = vi.fn(async () => response(200, { id: 'db1' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchJson('POST', '/api/databases', { parentId: 'p1' })).resolves.toEqual({
      id: 'db1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/databases',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ parentId: 'p1' }),
      }),
    );
  });

  it('answers null for an empty body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(204)),
    );
    await expect(fetchJson('DELETE', '/api/databases/db1/views/v1')).resolves.toBeNull();
  });

  it("throws the server's code and message", async () => {
    const message = 'This was deleted, or the link is wrong.';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(404, { error: { code: 'not_found', message } })),
    );
    const error: unknown = await fetchJson('GET', '/api/databases/gone').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'not_found', message });
  });

  it('says something went wrong when the server gives no reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(502)),
    );
    await expect(fetchJson('GET', '/api/databases/db1')).rejects.toMatchObject({
      status: 502,
      code: 'unknown',
      message: UNKNOWN_ERROR_MESSAGE,
    });
  });

  it("says when Care Hub can't be reached", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(fetchJson('GET', '/api/databases/db1')).rejects.toMatchObject({
      status: 0,
      code: 'offline',
      message: OFFLINE_MESSAGE,
    });
  });
});

describe('isApiError', () => {
  it('knows errors with a status and a code', () => {
    expect(isApiError(new ApiError(409, 'conflict', 'This database changed.'))).toBe(true);
    expect(isApiError(Object.assign(new Error('x'), { status: 403, code: 'forbidden' }))).toBe(
      true,
    );
    expect(isApiError(new Error('x'))).toBe(false);
    expect(isApiError({ status: 403, code: 'forbidden', message: 'x' })).toBe(false);
  });
});
