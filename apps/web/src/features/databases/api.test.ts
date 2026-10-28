import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createDatabaseClient,
  fetchJson,
  isApiError,
  personChoice,
  type HttpMethod,
} from './api';
import { jobsMembers } from './fixtures';

const lib = vi.hoisted(() => ({
  get: vi.fn(async () => ({ via: 'get' })),
  post: vi.fn(async () => ({ via: 'post' })),
  put: vi.fn(async () => ({ via: 'put' })),
  patch: vi.fn(async () => ({ via: 'patch' })),
  delete: vi.fn(async () => undefined),
}));

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  api: lib,
}));

/** Records each request; `answer` says what the server answers to it (by default `{ ok: true }`). */
function recorder(answer: (method: HttpMethod, path: string) => unknown = () => ({ ok: true })) {
  const calls: { method: HttpMethod; path: string; body: unknown }[] = [];
  const request = <T>(method: HttpMethod, path: string, body?: unknown): Promise<T> => {
    calls.push({ method, path, body });
    return Promise.resolve(answer(method, path) as T);
  };
  return { calls, client: createDatabaseClient(request) };
}

/** A server whose databases are at `version`, which every change moves on by one. */
function versioned(version: number) {
  return (method: HttpMethod, path: string) => {
    if (method !== 'GET') version += 1;
    return { id: path.split('/')[3], version };
  };
}

describe('createDatabaseClient', () => {
  it('sends each route to its path with its body', async () => {
    const { calls, client } = recorder();
    await client.getDatabase('db 1');
    await client.query('db1', { viewId: 'v1', override: null, search: '' });
    await client.query('db1', { viewId: 'v1', search: 'sink', cursor: 'c2' });
    await client.createRow('db1', { viewId: 'v1', groupKey: 'g1' });
    await client.updateRow('db1', 'r1', { p1: null });
    await client.trashRows('db1', ['r1', 'r2']);
    await client.duplicateRow('db1', 'r1');
    await client.moveRow('db1', 'v1', 'r1');
    await client.moveRow('db1', 'v1', 'r1', 'r2');
    await client.pickRows('db1', 'sink & drain');
    await client.applyTemplate('db1', 't1', 'r1', true);
    await client.exportCsv('db1', { scope: 'all' });
    await client.submitForm('code1', { q1: 'Yes' });
    await client.changeFormLink('db1', 'v2');

    expect(calls).toEqual([
      { method: 'GET', path: '/api/databases/db%201', body: undefined },
      { method: 'POST', path: '/api/databases/db1/query', body: { viewId: 'v1' } },
      {
        method: 'POST',
        path: '/api/databases/db1/query',
        body: { viewId: 'v1', search: 'sink', cursor: 'c2' },
      },
      { method: 'POST', path: '/api/databases/db1/rows', body: { viewId: 'v1', groupKey: 'g1' } },
      { method: 'PATCH', path: '/api/databases/db1/rows/r1', body: { values: { p1: null } } },
      { method: 'POST', path: '/api/databases/db1/rows/trash', body: { rowIds: ['r1', 'r2'] } },
      { method: 'POST', path: '/api/databases/db1/rows/r1/duplicate', body: undefined },
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
      { method: 'POST', path: '/api/databases/db1/export', body: { scope: 'all' } },
      { method: 'POST', path: '/api/forms/code1/responses', body: { answers: { q1: 'Yes' } } },
      { method: 'POST', path: '/api/forms/db1/views/v2/link', body: undefined },
    ]);
  });

  it('sends the newest version an answer has shown with each settings write', async () => {
    const { calls, client } = recorder(versioned(7));
    await client.getDatabase('db1');
    await client.updateDatabase('db1', { locked: true });
    await client.createProperty('db1', { name: 'Notes', config: { type: 'text' } });
    await client.updateProperty('db1', 'p1', { name: 'Job' });
    await client.undoTypeChange('db1', 'c1');
    await client.deleteProperty('db1', 'p1');
    await client.restoreProperty('db1', 'p1');
    await client.createView('db1', { layout: 'board', afterViewId: 'v1' });
    await client.duplicateView('db1', 'v1');
    await client.deleteView('db1', 'v1');
    await client.orderViews('db1', ['v2', 'v1']);
    await client.deleteTemplate('db1', 't1');
    await client.setAccessRules('db1', [{ id: 'a1', propertyId: 'p1', level: 'edit' }]);

    expect(calls.slice(1)).toEqual([
      { method: 'PATCH', path: '/api/databases/db1', body: { locked: true, version: 7 } },
      {
        method: 'POST',
        path: '/api/databases/db1/properties',
        body: { name: 'Notes', config: { type: 'text' }, version: 8 },
      },
      {
        method: 'PATCH',
        path: '/api/databases/db1/properties/p1',
        body: { name: 'Job', version: 9 },
      },
      {
        method: 'POST',
        path: '/api/databases/db1/type-changes/c1/undo',
        body: { version: 10 },
      },
      { method: 'DELETE', path: '/api/databases/db1/properties/p1?version=11', body: undefined },
      {
        method: 'POST',
        path: '/api/databases/db1/properties/p1/restore',
        body: { version: 12 },
      },
      {
        method: 'POST',
        path: '/api/databases/db1/views',
        body: { layout: 'board', afterViewId: 'v1', version: 13 },
      },
      { method: 'POST', path: '/api/databases/db1/views/v1/duplicate', body: { version: 14 } },
      { method: 'DELETE', path: '/api/databases/db1/views/v1?version=15', body: undefined },
      {
        method: 'PUT',
        path: '/api/databases/db1/views/order',
        body: { viewIds: ['v2', 'v1'], version: 16 },
      },
      { method: 'DELETE', path: '/api/databases/db1/templates/t1?version=17', body: undefined },
      {
        method: 'PUT',
        path: '/api/databases/db1/access-rules',
        body: { rules: [{ id: 'a1', propertyId: 'p1', level: 'edit' }], version: 18 },
      },
    ]);
  });

  it('loads the database first when no answer has shown its version yet', async () => {
    const { calls, client } = recorder(versioned(4));
    await client.deleteView('db2', 'v1');
    await client.duplicateView('db2', 'v2');

    expect(calls).toEqual([
      { method: 'GET', path: '/api/databases/db2', body: undefined },
      { method: 'DELETE', path: '/api/databases/db2/views/v1?version=4', body: undefined },
      { method: 'POST', path: '/api/databases/db2/views/v2/duplicate', body: { version: 5 } },
    ]);
  });

  it("loads a new database's version before its first change; a late answer never lowers it", async () => {
    // A new database comes back without a version.
    const versions = [undefined, 1, 2, 1, 3];
    const { calls, client } = recorder(() => ({ id: 'db9', version: versions.shift() }));
    await client.createDatabase({ parentId: 'page1', inline: true });
    await client.updateView('db9', 'v1', { name: 'Mine' });
    await client.getDatabase('db9'); // answered before the change, arriving after it
    await client.deleteView('db9', 'v1');

    expect(calls.map(({ method, path, body }) => [method, path, body])).toEqual([
      ['POST', '/api/databases', { parentId: 'page1', inline: true }],
      ['GET', '/api/databases/db9', undefined],
      ['PATCH', '/api/databases/db9/views/v1', { name: 'Mine', version: 1 }],
      ['GET', '/api/databases/db9', undefined],
      ['DELETE', '/api/databases/db9/views/v1?version=2', undefined],
    ]);
  });

  it("asks for the workspace's people, all of them or those matching", async () => {
    const { calls, client } = recorder(() => []);
    await client.listMembers();
    await client.listMembers('Avery Lin');
    expect(calls).toEqual([
      { method: 'GET', path: '/api/workspace/members', body: undefined },
      { method: 'GET', path: '/api/workspace/members?q=Avery%20Lin', body: undefined },
    ]);
  });
});

describe('fetchJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends each method through lib/api with its body', async () => {
    await expect(fetchJson('GET', '/api/databases/db1')).resolves.toEqual({ via: 'get' });
    await expect(fetchJson('POST', '/api/databases', { parentId: 'p1' })).resolves.toEqual({
      via: 'post',
    });
    await fetchJson('PUT', '/api/databases/db1/views/order', { viewIds: [] });
    await fetchJson('PATCH', '/api/databases/db1', { version: 1 });
    await expect(fetchJson('DELETE', '/api/databases/db1/views/v1?version=2')).resolves.toBe(
      undefined,
    );

    expect(lib.get).toHaveBeenCalledWith('/api/databases/db1');
    expect(lib.post).toHaveBeenCalledWith('/api/databases', { parentId: 'p1' });
    expect(lib.put).toHaveBeenCalledWith('/api/databases/db1/views/order', { viewIds: [] });
    expect(lib.patch).toHaveBeenCalledWith('/api/databases/db1', { version: 1 });
    expect(lib.delete).toHaveBeenCalledWith('/api/databases/db1/views/v1?version=2', undefined);
  });

  it("passes on lib/api's errors", async () => {
    const message = 'This was deleted, or the link is wrong.';
    lib.get.mockRejectedValueOnce(new ApiError(404, 'not_found', message));
    const error: unknown = await fetchJson('GET', '/api/databases/gone').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'not_found', message });
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

describe('personChoice', () => {
  it('lists a member by name and email, with a photo when they have one', () => {
    const [avery, jordan] = jobsMembers();
    if (!avery || !jordan) throw new Error('The fixture has two people.');
    expect(personChoice(avery)).toEqual({
      id: avery.id,
      name: 'Avery Lin',
      email: 'avery.lin@bluepine.example',
    });
    expect(personChoice(jordan)).toMatchObject({ avatarUrl: '/api/files/photo-jordan' });
  });
});
