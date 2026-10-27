import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import {
  getVersion,
  listVersions,
  nameVersion,
  restoreVersion,
  saveVersionBefore,
  versionLink,
} from './api';
import { fakeHistoryServer, fakeVersion, PAGE_ID } from './testServer';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function serve(options: Parameters<typeof fakeHistoryServer>[1] = {}) {
  const server = fakeHistoryServer(
    [fakeVersion('v-2', 5, 'Call the member today.'), fakeVersion('v-1', 60, 'Call the member.')],
    options,
  );
  globalThis.fetch = server.fetch;
  return server;
}

describe('the versions API', () => {
  it('lists versions, passing the cursor for the next ones', async () => {
    const server = serve({ pageSize: 1 });
    const first = await listVersions(PAGE_ID, null);
    expect(first.versions.map((one) => one.id)).toEqual(['v-2']);
    expect(first.nextCursor).toBe('v-2');

    await listVersions(PAGE_ID, '2026-10-27T18:00:00.000Z~v-2');
    expect(server.requests.map((one) => one.url)).toEqual([
      `/api/history/pages/${PAGE_ID}/versions`,
      `/api/history/pages/${PAGE_ID}/versions?before=2026-10-27T18%3A00%3A00.000Z~v-2`,
    ]);
  });

  it('gets a version with the one before it', async () => {
    serve();
    const answer = await getVersion(PAGE_ID, 'v-2');
    expect(answer.version.id).toBe('v-2');
    expect(answer.previous?.version.id).toBe('v-1');
  });

  it('turns refusals into ApiError without page details', async () => {
    serve({ listStatus: 403 });
    const error = await listVersions(PAGE_ID, null).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: "You don't have access to this." });
  });

  it('names, restores and saves versions', async () => {
    const server = serve();
    const named = await nameVersion(PAGE_ID, 'v-1', 'Before the audit');
    expect(named.version).toMatchObject({ id: 'v-1', name: 'Before the audit' });
    await nameVersion(PAGE_ID, 'v-1', null);

    const restored = await restoreVersion(PAGE_ID, 'v-1');
    expect(restored.version).toMatchObject({
      kind: 'before_restore',
      createdBy: { name: 'Avery Lin' },
    });
    const saved = await saveVersionBefore(PAGE_ID, 'accept_all');
    expect(saved?.kind).toBe('before_accept_all');

    const path = `/api/history/pages/${PAGE_ID}/versions`;
    expect(server.requests).toEqual([
      { method: 'PATCH', url: `${path}/v-1`, body: { name: 'Before the audit' } },
      { method: 'PATCH', url: `${path}/v-1`, body: { name: null } },
      { method: 'POST', url: `${path}/v-1/restore`, body: undefined },
      { method: 'POST', url: path, body: { reason: 'accept_all' } },
    ]);
  });

  it("passes on the server's reason when a restore is refused", async () => {
    serve({ changeError: { status: 403, message: 'This page is archived. Unarchive it first.' } });
    const error = await restoreVersion(PAGE_ID, 'v-1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      message: 'This page is archived. Unarchive it first.',
    });
  });

  it('answers null before a change to a page that keeps no versions, and passes on refusals', async () => {
    serve({ changeError: { status: 404, message: 'This was deleted, or the link is wrong.' } });
    expect(await saveVersionBefore(PAGE_ID, 'replace')).toBeNull();
    serve({ changeError: { status: 403, message: 'This page is locked. Unlock it first.' } });
    const error = await saveVersionBefore(PAGE_ID, 'replace').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 403, message: 'This page is locked. Unlock it first.' });
  });

  it('links to the page with the version to open', () => {
    expect(versionLink(PAGE_ID, 'v-2')).toBe(`${window.location.origin}/p/${PAGE_ID}?version=v-2`);
  });
});
