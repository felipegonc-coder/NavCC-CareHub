import { randomUUID } from 'node:crypto';
import {
  KB_PROPERTY,
  KB_STATUS_OPTION,
  addDays,
  addMonths,
  todayIn,
  wikiRowLimiter,
  type KbPageInfo,
} from '@carehub/extras/knowledge';
import type { AccessLevel } from '@carehub/shared';
import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { users } from '../auth/schema';
import { bindKnowledgePorts, rowAccessLimiter, type WikiBase, type WikiRow } from './ports';
import { kbBases, kbPages } from './schema';

const workspaceId = randomUUID();
/** The stand-in Databases lane and page model: wiki databases, their rows and each level. */
const bases = new Map<string, WikiBase>();
const rows = new Map<string, WikiRow>();
const levels = new Map<string, Map<string, AccessLevel>>();
const archived = new Set<string>();

function bindFakes() {
  return bindKnowledgePorts({
    accessForPages: async (_db, userId, pageIds) =>
      new Map(pageIds.map((id) => [id, levels.get(id)?.get(userId) ?? 'none'])),
    getBase: async (_db, id) => bases.get(id) ?? null,
    getRow: async (_db, id) => structuredClone(rows.get(id) ?? null),
    writeValues: async (_tx, { rowId, values }) => {
      const row = rows.get(rowId);
      if (row) row.values = { ...row.values, ...values };
    },
    archivePage: async (_tx, pageId) => {
      archived.add(pageId);
    },
  });
}

describe.skipIf(!hasDatabase)('knowledge base pages on Postgres', () => {
  let test: TestApp;
  /** Full access on the knowledge base. */
  let avery: TestUser;
  /** Can edit. */
  let sam: TestUser;
  /** Can edit content: rows come out as edit, but drafts stay hidden unless they own them. */
  let morgan: TestUser;
  /** Can view. */
  let riley: TestUser;
  let unbind: (() => void) | undefined;

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    morgan = await createUser(test.db, { name: 'Morgan Diaz', email: 'morgan.diaz@example.test' });
    riley = await createUser(test.db, { name: 'Riley Chen', email: 'riley.chen@example.test' });
    unbind = bindFakes();
  });
  afterAll(async () => {
    unbind?.();
    await test?.close();
  });

  function newBase(): string {
    const id = randomUUID();
    bases.set(id, { id, workspaceId, title: 'Support handbook' });
    levels.set(
      id,
      new Map<string, AccessLevel>([
        [avery.id, 'full'],
        [sam.id, 'edit'],
        [morgan.id, 'edit_content'],
        [riley.id, 'view'],
      ]),
    );
    return id;
  }
  /** A new row, as the Databases lane makes it: no knowledge base values yet. */
  function addPage(databaseId: string, by: TestUser, values: Record<string, unknown> = {}) {
    const id = randomUUID();
    rows.set(id, {
      id,
      databaseId,
      workspaceId,
      title: 'Refund policy',
      createdBy: by.id,
      values,
      tags: [],
    });
    levels.set(
      id,
      new Map<string, AccessLevel>([
        [avery.id, 'full'],
        [sam.id, 'edit'],
        [morgan.id, 'edit'],
        [riley.id, 'view'],
      ]),
    );
    return id;
  }
  const call = (
    user: TestUser,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => injectAs(test.app, user, { method, url, ...(payload ? { payload } : {}) });
  const page = (user: TestUser, pageId: string) =>
    call(user, 'GET', `/api/knowledge/pages/${pageId}`);
  const publish = (user: TestUser, pageId: string, status: 'draft' | 'published') =>
    call(user, 'PUT', `/api/knowledge/pages/${pageId}/status`, { status });
  const indexOf = async (pageId: string) =>
    (await test.db.select().from(kbPages).where(eq(kbPages.pageId, pageId)))[0];

  it('starts new pages as drafts that only their owner and editors can open (KB-03)', async () => {
    const kb = newBase();
    const draft = addPage(kb, morgan);

    const asRiley = await page(riley, draft);
    expect(asRiley.statusCode).toBe(403);
    expect(asRiley.json()).toEqual({
      error: { code: 'forbidden', message: "You don't have access to this." },
    });
    const asMorgan = await page(morgan, draft);
    expect(asMorgan.statusCode).toBe(200);
    const info = asMorgan.json() as KbPageInfo;
    expect(info.status).toBe('draft');
    expect(info.owners).toEqual([{ id: morgan.id, name: 'Morgan Diaz', canOpen: true }]);
    expect(info.verification).toBeNull();
    expect(info.baseTitle).toBe('Support handbook');
    expect(info.can).toMatchObject({
      publish: true,
      verify: true,
      changeOwners: false,
      report: false,
    });
    expect((await page(sam, draft)).statusCode).toBe(200);
    expect((await page(avery, draft)).statusCode).toBe(200);

    // Can edit content isn't Can edit: someone else's draft stays hidden.
    const samsDraft = addPage(kb, sam);
    expect((await page(morgan, samsDraft)).statusCode).toBe(403);
  });

  it('shows a published page to readers at once and hides it again on Back to draft (KB-04)', async () => {
    const kb = newBase();
    const pageId = addPage(kb, morgan);
    expect((await publish(riley, pageId, 'published')).statusCode).toBe(403);

    const published = await publish(sam, pageId, 'published');
    expect(published.statusCode).toBe(200);
    expect((published.json() as KbPageInfo).status).toBe('published');
    const asRiley = await page(riley, pageId);
    expect(asRiley.statusCode).toBe(200);
    expect((asRiley.json() as KbPageInfo).can).toMatchObject({ publish: false, report: true });
    expect(await indexOf(pageId)).toMatchObject({ status: 'published', publishedBy: sam.id });
    expect((await publish(riley, pageId, 'draft')).statusCode).toBe(403);

    expect((await publish(morgan, pageId, 'draft')).statusCode).toBe(200);
    expect((await page(riley, pageId)).statusCode).toBe(403);
    expect(await indexOf(pageId)).toMatchObject({
      status: 'draft',
      publishedBy: null,
      publishedAt: null,
    });
    expect(rows.get(pageId)?.values[KB_PROPERTY.status]).toBe(KB_STATUS_OPTION.draft);
  });

  it('verifies in the owner’s time zone, for owners and Full access only (KB-05)', async () => {
    await test.db.update(users).set({ timeZone: 'Asia/Tokyo' }).where(eq(users.id, morgan.id));
    const kb = newBase();
    const pageId = addPage(kb, morgan, { [KB_PROPERTY.status]: KB_STATUS_OPTION.published });
    const verify = (user: TestUser, body: object) =>
      call(user, 'POST', `/api/knowledge/pages/${pageId}/verification`, body);

    expect((await verify(sam, { period: '90d' })).statusCode).toBe(403);
    expect((await verify(riley, { period: '90d' })).statusCode).toBe(403);
    const response = await verify(morgan, { period: '90d' });
    expect(response.statusCode).toBe(200);
    const until = addDays(todayIn('Asia/Tokyo', new Date()), 90);
    expect((response.json() as KbPageInfo).verification).toMatchObject({
      state: 'verified',
      verifiedBy: { id: morgan.id, name: 'Morgan Diaz' },
      until,
    });
    expect(await indexOf(pageId)).toMatchObject({ verification: 'verified', verifiedUntil: until });

    expect((await verify(avery, { period: 'none' })).statusCode).toBe(200);
    expect((await indexOf(pageId))?.verifiedUntil).toBeNull();
    const pastDate = await verify(avery, { period: 'date', until: '2020-01-01' });
    expect(pastDate.statusCode).toBe(400);
    expect((await verify(avery, { period: 'forever' })).statusCode).toBe(400);

    const removed = await call(morgan, 'DELETE', `/api/knowledge/pages/${pageId}/verification`);
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as KbPageInfo).verification).toBeNull();
    expect(await indexOf(pageId)).toMatchObject({ verification: null, verifiedUntil: null });
  });

  it('keeps owners to people who can edit the page, picked by editors', async () => {
    const kb = newBase();
    const pageId = addPage(kb, morgan);
    const setOwners = (user: TestUser, owners: string[]) =>
      call(user, 'PUT', `/api/knowledge/pages/${pageId}/owners`, { owners });

    const reader = await setOwners(sam, [morgan.id, riley.id]);
    expect(reader.statusCode).toBe(409);
    expect(reader.json().error.details).toEqual({ cannotEdit: [riley.id] });
    expect((await setOwners(morgan, [morgan.id, sam.id])).statusCode).toBe(403);
    const sixOwners = Array.from({ length: 6 }, () => randomUUID());
    expect((await setOwners(sam, sixOwners)).statusCode).toBe(400);

    const response = await setOwners(sam, [sam.id, morgan.id]);
    expect(response.statusCode).toBe(200);
    expect((response.json() as KbPageInfo).owners.map((owner) => owner.name)).toEqual([
      'Sam Ortiz',
      'Morgan Diaz',
    ]);
    expect((await indexOf(pageId))?.owners).toEqual([sam.id, morgan.id]);

    const none = await setOwners(avery, []);
    expect((none.json() as KbPageInfo).owners).toEqual([]);
    // Without an owner, the creator loses the draft too: only editors see it.
    expect((await page(morgan, pageId)).statusCode).toBe(403);
  });

  it('renews with the default period from settings, which only Full access changes (KB-07)', async () => {
    await test.db.update(users).set({ timeZone: 'Asia/Tokyo' }).where(eq(users.id, morgan.id));
    const kb = newBase();
    const pageId = addPage(kb, morgan, { [KB_PROPERTY.status]: KB_STATUS_OPTION.published });
    const settingsUrl = `/api/knowledge/bases/${kb}/settings`;
    const review = (user: TestUser, action: string) =>
      call(user, 'POST', `/api/knowledge/pages/${pageId}/review`, { action });

    expect((await call(sam, 'GET', settingsUrl)).statusCode).toBe(403);
    expect((await call(sam, 'PATCH', settingsUrl, { defaultPeriod: '6m' })).statusCode).toBe(403);
    expect((await call(avery, 'GET', settingsUrl)).json()).toEqual({
      defaultPeriod: '90d',
      editingRemovesVerification: false,
    });
    const patched = await call(avery, 'PATCH', settingsUrl, { defaultPeriod: '6m' });
    expect(patched.json()).toEqual({ defaultPeriod: '6m', editingRemovesVerification: false });
    expect((await call(avery, 'PATCH', settingsUrl, {})).statusCode).toBe(400);

    expect((await review(riley, 'verify')).statusCode).toBe(403);
    const renewed = await review(morgan, 'verify');
    expect(renewed.statusCode).toBe(200);
    const until = addMonths(todayIn('Asia/Tokyo', new Date()), 6);
    expect((renewed.json() as KbPageInfo).verification?.until).toBe(until);
    expect((renewed.json() as KbPageInfo).defaultPeriod).toBe('6m');

    const needsChanges = await review(sam, 'needs_changes');
    expect(needsChanges.statusCode).toBe(200);
    expect((needsChanges.json() as KbPageInfo).verification?.until).toBe(until);
    expect((await review(riley, 'archive')).statusCode).toBe(403);
    expect((await review(sam, 'archive')).statusCode).toBe(204);
    expect(archived.has(pageId)).toBe(true);
  });

  it('answers 404 for pages outside a knowledge base and checks IDs', async () => {
    expect((await page(avery, randomUUID())).statusCode).toBe(404);
    expect(
      (await call(avery, 'GET', `/api/knowledge/bases/${randomUUID()}/settings`)).statusCode,
    ).toBe(404);
    expect((await call(avery, 'GET', '/api/knowledge/pages/not-a-page')).statusCode).toBe(400);
  });

  it('denies everything until the page model and Databases are bound', async () => {
    const kb = newBase();
    const pageId = addPage(kb, avery, { [KB_PROPERTY.status]: KB_STATUS_OPTION.published });
    unbind?.();
    try {
      expect((await page(avery, pageId)).statusCode).toBe(404);
      expect((await call(avery, 'GET', `/api/knowledge/bases/${kb}/settings`)).statusCode).toBe(
        404,
      );
    } finally {
      unbind = bindFakes();
    }
    expect((await page(avery, pageId)).statusCode).toBe(200);
  });

  it('registers the draft limiter for wiki databases', () => {
    expect(rowAccessLimiter('wiki')).toBe(wikiRowLimiter);
  });

  it('creates the knowledge tables exactly as the Drizzle definitions describe them', async () => {
    for (const table of [kbBases, kbPages]) {
      const config = getTableConfig(table);
      type Column = { name: string; type: string; not_null: boolean; has_default: boolean };
      const { rows: columns } = await test.db.execute<Column>(sql`
        SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
          attnotnull AS not_null, atthasdef AS has_default
        FROM pg_attribute
        WHERE attrelid = ${config.name}::regclass AND attnum > 0 AND NOT attisdropped`);
      const inDatabase = Object.fromEntries(
        columns.map((column) => [
          column.name,
          { type: column.type, notNull: column.not_null, hasDefault: column.has_default },
        ]),
      );
      const inDrizzle = Object.fromEntries(
        config.columns.map((column) => [
          column.name,
          { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
        ]),
      );
      expect(inDatabase, config.name).toEqual(inDrizzle);
    }
  });
});
