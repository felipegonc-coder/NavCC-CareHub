import { randomUUID } from 'node:crypto';
import type { UpdateListResponse } from '@carehub/extras/history';
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
import { bindHistoryPages, type HistoryPage } from './pages';
import { bindVisibleProperties } from './updateList';
import { recordUpdates, type NewUpdate } from './updates';

const MINUTE = 60 * 1000;

describe.skipIf(!hasDatabase)('the Updates API on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let riley: TestUser;
  let casey: TestUser;
  const workspaceId = randomUUID();
  const pages = new Map<string, HistoryPage>();
  const levels = new Map<string, Map<string, AccessLevel>>();
  const unbind: (() => void)[] = [];

  const levelOf = (userId: string, pageId: string) => levels.get(pageId)?.get(userId) ?? 'none';
  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin' });
    riley = await createUser(test.db, { name: 'Riley Chen' });
    casey = await createUser(test.db, { name: 'Casey Park' });
    unbind.push(
      bindHistoryPages({
        getPage: async (_db, id) => pages.get(id) ?? null,
        getPageAccess: async (_db, userId, id) => levelOf(userId, id),
        getPageTitles: async (_db, userId, ids) =>
          new Map(
            ids.flatMap((id): [string, string][] => {
              const page = pages.get(id);
              return page && levelOf(userId, id) !== 'none' ? [[id, page.title]] : [];
            }),
          ),
      }),
    );
  });
  afterAll(async () => {
    for (const off of unbind) off();
    await test?.close();
  });

  /** Avery can edit, Riley can view, Casey has no access. */
  function newPage(title: string, fields: Partial<HistoryPage> = {}): string {
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
    levels.set(
      id,
      new Map<string, AccessLevel>([
        [avery.id, 'edit'],
        [riley.id, 'view'],
      ]),
    );
    return id;
  }
  const start = Date.now() - 60 * MINUTE;
  const at = (minutes: number) => new Date(start + minutes * MINUTE);
  const entry = (pageId: string, minutes: number, fields: Partial<NewUpdate>): NewUpdate => ({
    pageId,
    workspaceId,
    kind: 'edited',
    by: avery.id,
    at: at(minutes),
    ...fields,
  });
  const list = async (user: TestUser, pageId: string, query = '') => {
    const response = await injectAs(test.app, user, {
      method: 'GET',
      url: `/api/history/pages/${pageId}/updates${query}`,
    });
    return { status: response.statusCode, body: response.json() as UpdateListResponse };
  };

  it('HT-08: shows who did what and when, newest first; Show changes only with Can edit', async () => {
    const pageId = newPage('Refund steps');
    const versionId = randomUUID();
    await recordUpdates(test.db, [
      entry(pageId, 0, { kind: 'created' }),
      entry(pageId, 5, { details: { changes: 3 }, versionId }),
      entry(pageId, 9, {
        kind: 'renamed',
        details: { title: { from: 'Refund steps', to: 'Refunds' } },
      }),
      entry(pageId, 12, { kind: 'commented', by: randomUUID(), details: { reply: true } }),
    ]);

    const asViewer = await list(riley, pageId);
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.nextCursor).toBeNull();
    expect(asViewer.body.updates.map((one) => one.kind)).toEqual([
      'commented',
      'renamed',
      'edited',
      'created',
    ]);
    const [comment, rename, edit] = asViewer.body.updates;
    // Someone no longer known shows as nobody.
    expect(comment).toMatchObject({ by: null, reply: true, at: at(12).toISOString() });
    expect(rename).toMatchObject({ title: { from: 'Refund steps', to: 'Refunds' } });
    expect(edit).toEqual({
      id: expect.any(String),
      kind: 'edited',
      at: at(5).toISOString(),
      by: { id: avery.id, name: 'Avery Lin' },
      changes: 3,
    });

    const asEditor = await list(avery, pageId);
    expect(asEditor.body.updates[2]).toMatchObject({ kind: 'edited', versionId });
  });

  it('HT-15: refuses people without access, without the title; missing pages are 404', async () => {
    const pageId = newPage('Staff salaries');
    await recordUpdates(test.db, [entry(pageId, 1, {})]);
    const refused = await injectAs(test.app, casey, {
      method: 'GET',
      url: `/api/history/pages/${pageId}/updates`,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.body).not.toContain('Staff salaries');
    expect((await list(riley, randomUUID())).status).toBe(404);
    expect((await list(riley, newPage('Old memo', { trashed: true }))).status).toBe(404);
    expect((await list(riley, 'not-a-page')).status).toBe(404);
  });

  it("names a page the person can't open as hidden, and the top of the space as top", async () => {
    const pageId = newPage('Phone tree');
    const policies = newPage('Policies');
    const secret = newPage('Board minutes');
    levels.get(secret)?.delete(riley.id);
    await recordUpdates(test.db, [
      entry(pageId, 1, { kind: 'moved', details: { move: { from: null, to: policies } } }),
      entry(pageId, 2, { kind: 'moved', details: { move: { from: policies, to: secret } } }),
    ]);

    const { body } = await list(riley, pageId);
    expect(body.updates.map((one) => one.move)).toEqual([
      { from: { kind: 'page', id: policies, title: 'Policies' }, to: { kind: 'hidden' } },
      { from: { kind: 'top' }, to: { kind: 'page', id: policies, title: 'Policies' } },
    ]);
    expect(JSON.stringify(body)).not.toContain('Board minutes');
    expect(JSON.stringify(body)).not.toContain(secret);

    const asEditor = await list(avery, pageId);
    expect(asEditor.body.updates[0]?.move?.to).toEqual({
      kind: 'page',
      id: secret,
      title: 'Board minutes',
    });
  });

  it("leaves out changes to properties the person can't see", async () => {
    const rowId = newPage('Visit with J. Doe', { kind: 'row' });
    const change = (id: string, name: string, from: string, to: string, minutes: number) =>
      entry(rowId, minutes, {
        kind: 'property_changed',
        details: { property: { id, name, from, to } },
      });
    await recordUpdates(test.db, [
      change('status', 'Status', 'Open', 'Done', 1),
      change('pay', 'Pay rate', '20', '25', 2),
    ]);
    // Until Databases tells which properties people see, no property change shows.
    expect((await list(riley, rowId)).body.updates).toEqual([]);

    unbind.push(
      bindVisibleProperties(
        async (_db, userId, _rowId, ids) =>
          new Set(ids.filter((id) => id !== 'pay' || userId === avery.id)),
      ),
    );
    const { body } = await list(riley, rowId);
    expect(body.updates).toEqual([
      expect.objectContaining({
        kind: 'property_changed',
        property: { name: 'Status', from: 'Open', to: 'Done' },
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('Pay rate');
    expect((await list(avery, rowId)).body.updates).toHaveLength(2);
  });

  it('pages through the entries, 50 at a time unless asked', async () => {
    const pageId = newPage('Busy page');
    await recordUpdates(
      test.db,
      Array.from({ length: 53 }, (_, index) => entry(pageId, index % 3, { details: {} })),
    );
    const first = await list(riley, pageId);
    expect(first.body.updates).toHaveLength(50);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const rest = await list(riley, pageId, `?before=${first.body.nextCursor}`);
    expect(rest.body.updates).toHaveLength(3);
    expect(rest.body.nextCursor).toBeNull();
    const ids = [...first.body.updates, ...rest.body.updates].map((one) => one.id);
    expect(new Set(ids).size).toBe(53);

    const two = await list(riley, pageId, '?limit=2');
    expect(two.body.updates).toHaveLength(2);
    expect((await list(riley, pageId, '?limit=500')).status).toBe(400);
  });

  it('pages through entries recorded together without a time, skipping none', async () => {
    const pageId = newPage('Quick edits');
    await recordUpdates(
      test.db,
      Array.from({ length: 3 }, () => entry(pageId, 0, { at: undefined, details: {} })),
    );
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const { body } = await list(riley, pageId, `?limit=1${cursor ? `&before=${cursor}` : ''}`);
      ids.push(...body.updates.map((one) => one.id));
      cursor = body.nextCursor;
    } while (cursor && ids.length < 5);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});
