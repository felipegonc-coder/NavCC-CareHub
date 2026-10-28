import { randomUUID } from 'node:crypto';
import type { SearchRecentResponse, SearchResponse } from '@carehub/extras/search';
import type { AccessLevel } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { listSearchTerms, reindexForSearch } from './index';
import { bindSearchMember, bindSearchPages, type IndexPage } from './pages';
import { recordSearch, searchTermOf, termDayOf } from './recent';
import {
  searchRecent,
  searchTermKeys,
  searchTermPeople,
  searchTerms,
  searchVisits,
} from './schema';

describe('search terms', () => {
  it('are lowercase with single spaces, up to 100 characters', () => {
    expect(searchTermOf('  Refund   POLICY ')).toBe('refund policy');
    expect(searchTermOf(`${'a'.repeat(99)}😀b`)).toBe(`${'a'.repeat(99)}😀`);
    expect(searchTermOf('   ')).toBe('');
  });

  it('are counted per day in Denver time', () => {
    expect(termDayOf(new Date('2026-10-28T05:59:00Z'))).toBe('2026-10-27');
    expect(termDayOf(new Date('2026-10-28T06:00:00Z'))).toBe('2026-10-28');
    expect(termDayOf('2026-10-01')).toBe('2026-10-01');
    expect(() => termDayOf('Oct 1')).toThrow();
  });
});

const pages = new Map<string, IndexPage>();
const levels = new Map<string, Map<string, AccessLevel>>();
const DAY_MS = 24 * 60 * 60 * 1000;

type Bus = { emit(name: string, payload: unknown): void; settled(): Promise<void> };

describe.skipIf(!hasDatabase)('recent lists and search terms on Postgres', () => {
  let test: TestApp;
  let val: TestUser;
  let eli: TestUser;
  let riley: TestUser;
  let workspaceId = randomUUID();
  /** Who is in which workspace; Riley is in none. */
  const memberships = new Map<string, string>();
  const unbind: (() => void)[] = [];

  beforeAll(async () => {
    test = await createTestApp();
    val = await createUser(test.db, { name: 'Val Moreno', email: 'val.moreno@example.test' });
    eli = await createUser(test.db, { name: 'Eli Brooks', email: 'eli.brooks@example.test' });
    riley = await createUser(test.db, { name: 'Riley Chen', email: 'riley.chen@example.test' });
    unbind.push(
      bindSearchPages({
        getPagesForIndex: async (_db, ids) =>
          new Map(ids.flatMap((id) => (pages.has(id) ? [[id, pages.get(id)!] as const] : []))),
        getAccessForPages: async (_db, userId, ids) =>
          new Map(ids.map((id) => [id, levels.get(id)?.get(userId) ?? 'none'])),
      }),
      bindSearchMember((request) => {
        const id = request.user && memberships.get(request.user.id);
        return id ? { workspaceId: id, isGuest: false } : null;
      }),
    );
  });
  afterAll(async () => {
    for (const off of unbind) off();
    await test?.close();
  });
  beforeEach(() => {
    workspaceId = randomUUID();
    memberships.set(val.id, workspaceId);
    memberships.set(eli.id, workspaceId);
  });

  async function addPage(
    title: string,
    open: TestUser[] = [val, eli],
    fields: Partial<IndexPage> = {},
  ) {
    const id = randomUUID();
    pages.set(id, {
      id,
      workspaceId,
      spaceId: null,
      parentId: null,
      ancestorIds: [],
      kind: 'page',
      title,
      icon: null,
      createdBy: eli.id,
      createdAt: new Date(Date.now() - 60 * DAY_MS),
      updatedBy: eli.id,
      updatedAt: new Date(Date.now() - 60 * DAY_MS),
      archivedAt: null,
      trashed: false,
      ...fields,
    });
    levels.set(id, new Map(open.map((user) => [user.id, 'view'])));
    await reindexForSearch(test.db, [id]);
    return id;
  }
  const call = (user: TestUser, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    injectAs(test.app, user, { method, url: `/api/search${url}`, ...(payload ? { payload } : {}) });
  async function recent(user: TestUser) {
    const response = await call(user, 'GET', '/recent');
    expect(response.statusCode, response.body).toBe(200);
    return response.json<SearchRecentResponse>();
  }
  async function visit(user: TestUser, pageId: string) {
    expect((await call(user, 'POST', '/visits', { pageId })).statusCode).toBe(204);
  }
  async function searched(user: TestUser, text: string, extra: object = {}) {
    const body = { text, save: true, found: 1, ...extra };
    const response = await call(user, 'POST', '/history', body);
    expect(response.statusCode, response.body).toBe(204);
  }

  it('mirrors its migration', async () => {
    for (const table of [
      searchRecent,
      searchVisits,
      searchTerms,
      searchTermKeys,
      searchTermPeople,
    ]) {
      const config = getTableConfig(table);
      type Column = { name: string; type: string; not_null: boolean; has_default: boolean };
      const { rows } = await test.db.execute<Column>(sql`
        SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
          attnotnull AS not_null, atthasdef AS has_default
        FROM pg_attribute
        WHERE attrelid = ${config.name}::regclass AND attnum > 0 AND NOT attisdropped`);
      const inDatabase = Object.fromEntries(
        rows.map((row) => [row.name, [row.type, row.not_null, row.has_default]]),
      );
      const inDrizzle = Object.fromEntries(
        config.columns.map((column) => [
          column.name,
          [column.getSQLType(), column.notNull, column.hasDefault],
        ]),
      );
      expect(inDrizzle, config.name).toEqual(inDatabase);
    }
  });

  it('shows the last 8 pages the person opened and can still open, newest first (SR-02)', async () => {
    const ids: string[] = [];
    for (const number of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      ids.push(await addPage(`Recent ${number}`));
      await visit(val, ids.at(-1)!);
    }
    const hidden = await addPage('Pay bands', [eli]);
    await visit(val, hidden);
    await visit(val, ids[2]!);
    const titles = (list: SearchRecentResponse) => list.pages.map((page) => page.title);
    expect(titles(await recent(val))).toEqual([3, 9, 8, 7, 6, 5, 4, 2].map((n) => `Recent ${n}`));
    expect((await recent(eli)).pages).toEqual([]);

    // Trash and lost access take pages off at once; another workspace has its own list.
    pages.set(ids[8]!, { ...pages.get(ids[8]!)!, trashed: true });
    await reindexForSearch(test.db, [ids[8]!]);
    levels.get(ids[7]!)?.delete(val.id);
    expect(titles(await recent(val))).toEqual([3, 7, 6, 5, 4, 2, 1].map((n) => `Recent ${n}`));
    memberships.set(val.id, randomUUID());
    expect((await recent(val)).pages).toEqual([]);
  });

  it('records page.viewed events and opened results as visits', async () => {
    const viewed = await addPage('Viewed page');
    const opened = await addPage('Opened page');
    const events = test.app.events as unknown as Bus;
    events.emit('page.viewed', { pageId: viewed, userId: val.id, workspaceId });
    await events.settled();
    await searched(val, 'opened', { opened });
    expect((await recent(val)).pages.map((page) => page.title)).toEqual([
      'Opened page',
      'Viewed page',
    ]);
  });

  it('keeps each person’s last 5 searches, newest first; Clear and ✕ change only their own (SR-02)', async () => {
    for (const text of ['one', 'two', 'three', 'four', 'five', 'six']) await searched(val, text);
    await searched(val, 'THREE', { filters: { titleOnly: true } });
    await searched(val, 'not saved', { save: false });
    await searched(eli, 'eli only');
    const list = await recent(val);
    expect(list.searches.map((search) => search.text)).toEqual([
      'THREE',
      'six',
      'five',
      'four',
      'two',
    ]);
    expect(list.searches[0]?.filters).toEqual({ titleOnly: true });

    const eliSearch = (await recent(eli)).searches[0]!;
    expect((await call(val, 'DELETE', `/recent/${eliSearch.id}`)).statusCode).toBe(204);
    expect((await recent(eli)).searches).toHaveLength(1);
    expect((await call(val, 'DELETE', `/recent/${list.searches[1]!.id}`)).statusCode).toBe(204);
    expect((await recent(val)).searches.map((search) => search.text)).toEqual([
      'THREE',
      'five',
      'four',
      'two',
    ]);
    expect((await call(val, 'DELETE', '/recent')).statusCode).toBe(204);
    expect((await recent(val)).searches).toEqual([]);
    expect((await recent(eli)).searches).toHaveLength(1);
  });

  it('counts search terms without who searched, listing a term once 2 people searched it (SR-15)', async () => {
    const day = new Date('2026-10-20T18:00:00Z');
    const later = new Date('2026-10-21T18:00:00Z');
    const as = (user: TestUser) => ({ userId: user.id, workspaceId });
    const base = { filters: {}, save: false, found: 3 };
    const period = { from: '2026-10-01', to: '2026-10-31' };
    await recordSearch(test.db, as(val), { ...base, text: 'Refund policy' }, day);
    await recordSearch(test.db, as(val), { ...base, text: 'refund  POLICY', found: 0 }, day);
    await recordSearch(test.db, as(val), { ...base, text: 'pay bands' }, day);
    expect(await listSearchTerms(test.db, workspaceId, period)).toEqual([]);

    await recordSearch(
      test.db,
      as(eli),
      { ...base, text: 'refund policy', opened: randomUUID() },
      day,
    );
    await recordSearch(test.db, as(val), { ...base, text: 'pay bands' }, later);
    const listed = [{ term: 'refund policy', searches: 3, people: 2, noResults: 1, opened: 1 }];
    expect(await listSearchTerms(test.db, workspaceId, period)).toEqual(listed);
    expect(await listSearchTerms(test.db, workspaceId, { from: day, to: day })).toEqual(listed);
    expect(await listSearchTerms(test.db, workspaceId, { from: later, to: later })).toEqual([]);
    expect(await listSearchTerms(test.db, randomUUID(), period)).toEqual([]);

    // Only counts are kept: no person, and once the day is over its keys and hashes are gone.
    const { rows } = await test.db.execute<{ row: string }>(
      sql`SELECT row_to_json(t)::text AS row FROM search_terms t WHERE workspace_id = ${workspaceId}`,
    );
    expect(rows).toHaveLength(3);
    for (const { row } of rows) expect(row).not.toMatch(new RegExp(`${val.id}|${eli.id}`));
    const left = await test.db.execute<{ n: number }>(sql`
      SELECT (SELECT count(*) FROM search_term_keys WHERE day = '2026-10-20')::int
        + (SELECT count(*) FROM search_term_people WHERE day = '2026-10-20')::int AS n`);
    expect(left.rows[0]?.n).toBe(0);
  });

  it('ranks pages the person opened in the last 30 days higher (SR-05)', async () => {
    await addPage('Lantern notes');
    const opened = await addPage('Lantern guide', [val, eli], {
      updatedAt: new Date(Date.now() - 90 * DAY_MS),
    });
    const titles = async (user: TestUser) => {
      const response = await call(user, 'POST', '/query', { text: 'lantern' });
      return response.json<SearchResponse>().results.map((result) => result.title);
    };
    expect(await titles(val)).toEqual(['Lantern notes', 'Lantern guide']);
    await visit(val, opened);
    expect(await titles(val)).toEqual(['Lantern guide', 'Lantern notes']);
    expect(await titles(eli)).toEqual(['Lantern notes', 'Lantern guide']);
  });

  it('checks who asks and what they send', async () => {
    const hidden = await addPage('Pay bands', [eli]);
    await visit(val, hidden);
    expect((await recent(val)).pages).toEqual([]);
    expect((await call(riley, 'GET', '/recent')).statusCode).toBe(403);
    expect(
      (await call(riley, 'POST', '/history', { text: 'x', save: true, found: 0 })).statusCode,
    ).toBe(403);
    expect(
      (await call(val, 'POST', '/history', { text: '  ', save: true, found: 0 })).statusCode,
    ).toBe(400);
    expect(
      (await call(val, 'POST', '/history', { text: 'a', save: true, found: 0, userId: eli.id }))
        .statusCode,
    ).toBe(400);
    expect((await call(val, 'DELETE', '/recent/not-an-id')).statusCode).toBe(400);
    expect((await call(val, 'POST', '/visits', { pageId: 'x' })).statusCode).toBe(400);
    const signedOut = await test.app.inject({ method: 'GET', url: '/api/search/recent' });
    expect(signedOut.statusCode).toBe(401);
  });
});
