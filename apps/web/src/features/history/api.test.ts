import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { getVersion, listVersions, versionLink } from './api';
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

  it('links to the page with the version to open', () => {
    expect(versionLink(PAGE_ID, 'v-2')).toBe(`${window.location.origin}/p/${PAGE_ID}?version=v-2`);
  });
});
