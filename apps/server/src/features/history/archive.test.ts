import { randomUUID } from 'node:crypto';
import type { ArchiveState, UpdateListResponse } from '@carehub/extras/history';
import type { AccessLevel } from '@carehub/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { ROWS_REFUSED } from './archive';
import { bindHistoryPages, type HistoryPage, type PageArchive } from './pages';

const ARCHIVED_AT = new Date('2026-10-20T21:15:00Z');

describe.skipIf(!hasDatabase)('the archive API on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let casey: TestUser;
  const workspaceId = randomUUID();
  const pages = new Map<string, HistoryPage>();
  /** Sub-page → parent page. */
  const parents = new Map<string, string>();
  /** The pages that were archived themselves (not with a parent). */
  const archives = new Map<string, PageArchive>();
  const levels = new Map<string, Map<string, AccessLevel>>();
  const events: { name: string; payload: unknown }[] = [];
  const unbind: (() => void)[] = [];

  const subtree = (id: string): string[] => [
    id,
    ...[...parents].flatMap(([child, parent]) => (parent === id ? subtree(child) : [])),
  ];
  const archiveOf = (id: string): PageArchive | null => {
    for (let at: string | undefined = id; at; at = parents.get(at)) {
      const found = archives.get(at);
      if (found) return found;
    }
    return null;
  };

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin' });
    sam = await createUser(test.db, { name: 'Sam Ortiz' });
    casey = await createUser(test.db, { name: 'Casey Park' });
    // A fake page model: archiving marks the page, and its sub-pages go along.
    unbind.push(
      bindHistoryPages({
        getPage: async (_db, id) => {
          const page = pages.get(id);
          return page ? { ...page, archivedAt: archiveOf(id)?.at ?? null } : null;
        },
        getPageAccess: async (_db, userId, id) => levels.get(id)?.get(userId) ?? 'none',
        getArchive: async (_db, id) => archiveOf(id),
        countSubPages: async (_db, id) => subtree(id).length - 1,
        archivePage: async (_tx, id, by) => {
          archives.set(id, { pageId: id, by, at: ARCHIVED_AT });
          return subtree(id);
        },
        unarchivePage: async (_tx, id) => {
          archives.delete(id);
          return subtree(id);
        },
      }),
    );
    const loose = test.app.events as unknown as {
      on(name: string, handler: (payload: unknown) => void): () => void;
    };
    for (const name of ['page.archived', 'page.unarchived']) {
      unbind.push(loose.on(name, (payload) => void events.push({ name, payload })));
    }
  });
  afterAll(async () => {
    for (const off of unbind) off();
    await test?.close();
  });

  /** Avery has Full access, Sam can edit, Casey has no access. */
  function newPage(title: string, fields: Partial<HistoryPage> = {}, parentId?: string): string {
    const id = randomUUID();
    pages.set(id, {
      id,
      workspaceId,
      kind: 'page',
      title,
      icon: null,
      cover: null,
      style: {},
      locked: false,
      trashed: false,
      archivedAt: null,
      ...fields,
    });
    if (parentId) parents.set(id, parentId);
    levels.set(
      id,
      new Map<string, AccessLevel>([
        [avery.id, 'full'],
        [sam.id, 'edit'],
      ]),
    );
    return id;
  }
  const call = (user: TestUser, method: 'GET' | 'POST', pageId: string, action = 'archive') =>
    injectAs(test.app, user, { method, url: `/api/history/pages/${pageId}/${action}` });
  const stateOf = async (user: TestUser, pageId: string) =>
    (await call(user, 'GET', pageId)).json() as ArchiveState;

  it('HT-14: archives a page with its sub-pages, and unarchives it all from a sub-page', async () => {
    const policies = newPage('Policies');
    const refunds = newPage('Refunds', {}, policies);
    const steps = newPage('Refund steps', {}, refunds);
    const returns = newPage('Returns', {}, policies);
    const all = [policies, refunds, steps, returns].sort();

    expect(await stateOf(avery, policies)).toEqual({
      archived: null,
      canChange: true,
      subPages: 3,
    });
    expect(await stateOf(sam, policies)).toEqual({ archived: null, canChange: false, subPages: 0 });

    const archived = await call(avery, 'POST', policies);
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toEqual({ pageId: policies, title: 'Policies', subPages: 3 });

    // Every sub-page shows the banner; only Full access on Policies may unarchive.
    const banner = { by: { id: avery.id, name: 'Avery Lin' }, at: ARCHIVED_AT.toISOString() };
    expect(await stateOf(sam, steps)).toEqual({ archived: banner, canChange: false, subPages: 0 });
    expect(await stateOf(avery, steps)).toEqual({ archived: banner, canChange: true, subPages: 3 });
    const twice = await call(avery, 'POST', refunds);
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.message).toBe('This page is already archived.');
    const refused = await call(sam, 'POST', steps, 'unarchive');
    expect(refused.statusCode).toBe(403);
    expect(refused.body).not.toContain('Policies');

    const back = await call(avery, 'POST', steps, 'unarchive');
    expect(back.json()).toEqual({ pageId: policies, title: 'Policies', subPages: 3 });
    expect(await stateOf(sam, steps)).toEqual({ archived: null, canChange: false, subPages: 0 });

    await test.app.events.settled();
    const sent = events.filter(
      ({ payload }) => (payload as { pageId: string }).pageId === policies,
    );
    expect(sent.map(({ name }) => name)).toEqual(['page.archived', 'page.unarchived']);
    for (const { payload } of sent) {
      const { pageIds, ...rest } = payload as { pageIds: string[] };
      expect(rest).toEqual({ pageId: policies, by: avery.id });
      expect([...pageIds].sort()).toEqual(all);
    }
    // Updates shows both (HT-08).
    const updates = (await call(sam, 'GET', policies, 'updates')).json() as UpdateListResponse;
    expect(updates.updates.map(({ kind, by }) => [kind, by?.name])).toEqual([
      ['unarchived', 'Avery Lin'],
      ['archived', 'Avery Lin'],
    ]);
  });

  it("HT-15: refuses rows, people without Full access, pages in Trash and pages that aren't archived", async () => {
    const table = newPage('Tickets', { kind: 'database' });
    const row = newPage('Ticket 1042', { kind: 'row' }, table);
    const rowAnswer = await call(avery, 'POST', row);
    expect(rowAnswer.statusCode).toBe(409);
    expect(rowAnswer.json().error.message).toBe(ROWS_REFUSED);
    expect((await stateOf(avery, row)).canChange).toBe(false);

    const page = newPage('Secret plans');
    for (const [user, method, status] of [
      [sam, 'POST', 403],
      [casey, 'POST', 403],
      [casey, 'GET', 403],
    ] as const) {
      const answer = await call(user, method, page);
      expect(answer.statusCode).toBe(status);
      expect(answer.body).not.toContain('Secret plans');
    }
    const notArchived = await call(avery, 'POST', page, 'unarchive');
    expect(notArchived.statusCode).toBe(409);
    expect(notArchived.json().error.message).toBe("This page isn't archived.");

    const trashed = newPage('Old notes', { trashed: true });
    expect((await call(avery, 'POST', trashed)).statusCode).toBe(404);
    expect((await call(avery, 'GET', trashed)).statusCode).toBe(404);
    expect((await call(avery, 'POST', 'not-a-page')).statusCode).toBe(404);
    expect([row, page, trashed].filter((id) => archives.has(id))).toEqual([]);
  });
});
