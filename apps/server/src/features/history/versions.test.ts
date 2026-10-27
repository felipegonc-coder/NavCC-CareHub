import { randomUUID } from 'node:crypto';
import type { HistoryDoc } from '@carehub/extras/history';
import { asc, eq, sql } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp, type TestUser } from '../../testing';
import { bindHistoryContent } from './content';
import { saveVersionNow } from './index';
import { bindHistoryPages, type HistoryPage } from './pages';
import { historyEdits, historyVersions } from './schema';
import { pageIdsOf } from './tracker';
import { isDue, recordEdit, recordSavedEdits, saveDueVersions, settleEdits } from './versions';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const after = (start: Date, ms: number) => new Date(start.getTime() + ms);

describe('isDue', () => {
  const start = new Date('2026-10-20T15:00:00Z');

  it('waits 2 minutes after the last edit', () => {
    const edits = { firstAt: start, lastAt: after(start, MINUTE) };
    expect(isDue(edits, after(start, MINUTE + 105 * SECOND))).toBe(false);
    expect(isDue(edits, after(start, 3 * MINUTE))).toBe(true);
  });

  it('saves long sessions within 10 minutes, and nothing without edits', () => {
    const edits = { firstAt: start, lastAt: after(start, 9 * MINUTE) };
    expect(isDue(edits, after(start, 9 * MINUTE + 30 * SECOND))).toBe(true);
    expect(isDue({ firstAt: null, lastAt: null }, after(start, MINUTE))).toBe(false);
  });
});

describe('pageIdsOf', () => {
  it('reads pageId and pageIds', () => {
    expect(pageIdsOf({ pageId: 'a', pageIds: ['b', 'a', 3] })).toEqual(['a', 'b']);
    expect(pageIdsOf(null)).toEqual([]);
  });
});

describe.skipIf(!hasDatabase)('versions on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  const pages = new Map<string, HistoryPage>();
  const docs = new Map<string, HistoryDoc>();
  const unbind: (() => void)[] = [];

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    unbind.push(
      bindHistoryPages({ getPage: async (_db, id) => pages.get(id) ?? null }),
      bindHistoryContent({
        getPageContent: async (_db, id) => docs.get(id) ?? { type: 'doc', content: [] },
        setPageContent: async (_tx, id, doc) => {
          docs.set(id, doc);
        },
      }),
    );
  });
  afterAll(async () => {
    for (const off of unbind) off();
    await test?.close();
  });

  const workspaceId = randomUUID();
  function addPage(title: string, text: string, fields: Partial<HistoryPage> = {}): string {
    const id = randomUUID();
    pages.set(id, {
      id,
      workspaceId,
      kind: 'page',
      title,
      icon: { type: 'emoji', emoji: '📄' },
      cover: null,
      style: { fullWidth: false },
      locked: false,
      trashed: false,
      ...fields,
    });
    write(id, text);
    return id;
  }
  function write(pageId: string, text: string) {
    docs.set(pageId, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
  }
  const versionsOf = (pageId: string) =>
    test.db
      .select()
      .from(historyVersions)
      .where(eq(historyVersions.pageId, pageId))
      .orderBy(asc(historyVersions.createdAt));
  const savedFor = async (pageId: string, now: Date) =>
    (await saveDueVersions(test.db, now)).filter((version) => version.pageId === pageId);
  const textOf = (doc: HistoryDoc) => doc.content[0]?.content?.[0]?.text;

  async function columnsOf(table: PgTable) {
    const config = getTableConfig(table);
    type Column = { name: string; type: string; not_null: boolean; has_default: boolean };
    const { rows } = await test.db.execute<Column>(sql`
      SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
        attnotnull AS not_null, atthasdef AS has_default
      FROM pg_attribute
      WHERE attrelid = ${config.name}::regclass AND attnum > 0 AND NOT attisdropped`);
    const inDatabase = Object.fromEntries(
      rows.map((row) => [
        row.name,
        { type: row.type, notNull: row.not_null, hasDefault: row.has_default },
      ]),
    );
    const inDrizzle = Object.fromEntries(
      config.columns.map((column) => [
        column.name,
        { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
      ]),
    );
    return { inDatabase, inDrizzle };
  }

  it('mirrors its migration', async () => {
    for (const table of [historyVersions, historyEdits]) {
      const { inDatabase, inDrizzle } = await columnsOf(table);
      expect(inDrizzle).toEqual(inDatabase);
    }
  });

  it('HT-01: a minute of edits and a 2-minute pause save one version naming everyone', async () => {
    const pageId = addPage('Refund steps', 'Check the order number.');
    const start = new Date(Date.now() - 10 * MINUTE);
    await recordEdit(test.db, pageId, [avery.id], start);
    await recordEdit(test.db, pageId, [sam.id, avery.id], after(start, 30 * SECOND));
    write(pageId, 'Check the order number, then the card.');
    await recordEdit(test.db, pageId, [avery.id], after(start, MINUTE));

    expect(await savedFor(pageId, after(start, MINUTE + 105 * SECOND))).toEqual([]);
    expect(await savedFor(pageId, after(start, 3 * MINUTE))).toHaveLength(1);
    expect(await savedFor(pageId, after(start, 4 * MINUTE))).toEqual([]);

    const [version, ...others] = await versionsOf(pageId);
    expect(others).toEqual([]);
    expect(version).toMatchObject({
      kind: 'automatic',
      editorIds: [avery.id, sam.id],
      createdBy: null,
      title: 'Refund steps',
      icon: { type: 'emoji', emoji: '📄' },
      style: { fullWidth: false },
      name: null,
      workspaceId,
    });
    expect(textOf(version!.content)).toBe('Check the order number, then the card.');
    expect(version!.size).toBeGreaterThan(0);
  });

  it('HT-01: an hour of non-stop typing saves at least 6 versions', async () => {
    const pageId = addPage('Shift notes', 'Start');
    const start = new Date(Date.now() - 2 * 60 * MINUTE);
    // A save every 10 seconds and the check every 15 seconds, for an hour.
    for (let ms = 0; ms < 60 * MINUTE; ms += 5 * SECOND) {
      if (ms % (10 * SECOND) === 0) {
        write(pageId, `Typed for ${ms / SECOND} seconds`);
        await recordEdit(test.db, pageId, [sam.id], after(start, ms));
      }
      if (ms % (15 * SECOND) === 0) await savedFor(pageId, after(start, ms));
    }
    expect((await versionsOf(pageId)).length).toBeGreaterThanOrEqual(6);
  });

  it('HT-02: saves a version before a change, with the edits not saved yet', async () => {
    const pageId = addPage('Intake form', 'Ask for the name.');
    const start = new Date(Date.now() - MINUTE);
    await recordEdit(test.db, pageId, [sam.id], start);

    const version = await test.db.transaction((tx) =>
      saveVersionNow(tx, pageId, { reason: 'import', by: avery.id }),
    );
    expect(version).toMatchObject({ pageId, kind: 'before_import' });
    const [saved] = await versionsOf(pageId);
    expect(saved).toMatchObject({
      kind: 'before_import',
      editorIds: [sam.id],
      createdBy: avery.id,
    });
    expect(textOf(saved!.content)).toBe('Ask for the name.');

    // Its edits are in that version, so no automatic one follows for them.
    expect(await savedFor(pageId, after(start, 5 * MINUTE))).toEqual([]);
    await recordEdit(test.db, pageId, [sam.id], start);
    expect(await savedFor(pageId, after(start, 5 * MINUTE))).toEqual([]);
  });

  it('HT-02: a rollback drops the version too', async () => {
    const pageId = addPage('Escalations', 'Call the lead.');
    await expect(
      test.db.transaction(async (tx) => {
        await saveVersionNow(tx, pageId, { reason: 'template', by: avery.id });
        throw new Error('The template failed.');
      }),
    ).rejects.toThrow('The template failed.');
    expect(await versionsOf(pageId)).toEqual([]);
  });

  it('saves every "before" version, even when nothing changed since the last one', async () => {
    const pageId = addPage('Holiday hours', 'Closed on Nov 26.');
    await saveVersionNow(test.db, pageId, { reason: 'replace', by: sam.id });
    await saveVersionNow(test.db, pageId, { reason: 'restore', by: avery.id });
    const kinds = (await versionsOf(pageId)).map((version) => version.kind);
    expect(kinds.sort()).toEqual(['before_replace', 'before_restore']);
  });

  it("doesn't keep an automatic version identical to the newest one", async () => {
    const pageId = addPage('Phone tree', 'Press 1 for billing.');
    await saveVersionNow(test.db, pageId, { reason: 'accept_all', by: avery.id });
    const start = new Date(Date.now() + SECOND);
    await recordEdit(test.db, pageId, [sam.id], start);
    expect(await savedFor(pageId, after(start, 3 * MINUTE))).toEqual([]);
    expect((await versionsOf(pageId)).map((version) => version.kind)).toEqual([
      'before_accept_all',
    ]);
  });

  it('saves nothing for missing pages, pages in Trash and databases', async () => {
    const inTrash = addPage('Old policy', 'Gone.', { trashed: true });
    const database = addPage('Cases', '', { kind: 'database' });
    for (const pageId of [randomUUID(), inTrash, database]) {
      expect(await saveVersionNow(test.db, pageId, { reason: 'import', by: sam.id })).toBeNull();
      await recordEdit(test.db, pageId, [sam.id], new Date(Date.now() - 5 * MINUTE));
      expect(await savedFor(pageId, new Date())).toEqual([]);
      expect(await versionsOf(pageId)).toEqual([]);
    }
  });

  it("refuses reasons it doesn't know", async () => {
    const pageId = addPage('Scripts', 'Hello.');
    const reason = 'paste' as unknown as 'import';
    await expect(saveVersionNow(test.db, pageId, { reason, by: null })).rejects.toThrow(TypeError);
  });

  it('skips saves that are in a version already (a restore settles its own write)', async () => {
    const pageId = addPage('Callbacks', 'Within a day.');
    const restoredAt = new Date(Date.now() - 3 * MINUTE);
    await settleEdits(test.db, pageId, restoredAt);
    await recordEdit(test.db, pageId, [avery.id], restoredAt);
    expect(await savedFor(pageId, new Date())).toEqual([]);
  });

  it('stand-in: reads the collaboration server saves from page_docs', async () => {
    const pageId = addPage('Returns', 'Within 30 days.');
    await test.db.execute(sql`
      INSERT INTO page_docs (page_id, state, updated_at, updated_by)
      VALUES (${pageId}, '\\x'::bytea, now() - interval '10 seconds', ${sam.id})`);
    await recordSavedEdits(test.db);
    await recordSavedEdits(test.db);
    const [edits] = await test.db
      .select()
      .from(historyEdits)
      .where(eq(historyEdits.pageId, pageId));
    expect(edits?.editorIds).toEqual([sam.id]);
    expect(edits?.firstAt).toEqual(edits?.lastAt);
    // Postgres keeps microseconds and JavaScript dates don't, so check a second after the pause.
    expect(await savedFor(pageId, after(edits!.lastAt!, 2 * MINUTE + SECOND))).toHaveLength(1);
    // The same save isn't read again once it's in a version.
    await recordSavedEdits(test.db);
    expect(await savedFor(pageId, after(edits!.lastAt!, 4 * MINUTE))).toEqual([]);
  });

  it('page.contentSaved opens a stretch naming everyone who saved', async () => {
    const pageId = addPage('Greeting', 'Hi there.');
    const events = test.app.events as unknown as {
      emit(name: string, payload: unknown): void;
      settled(): Promise<void>;
    };
    events.emit('page.contentSaved', { pageId, userIds: [sam.id, avery.id] });
    await events.settled();
    const [edits] = await test.db
      .select()
      .from(historyEdits)
      .where(eq(historyEdits.pageId, pageId));
    expect(edits?.editorIds).toEqual([sam.id, avery.id]);
  });

  it('HT-11: page.deleted removes the page’s versions', async () => {
    const pageId = addPage('Draft', 'To delete.');
    await saveVersionNow(test.db, pageId, { reason: 'import', by: sam.id });
    const events = test.app.events as unknown as {
      emit(name: string, payload: unknown): void;
      settled(): Promise<void>;
    };
    events.emit('page.deleted', { pageId, pageIds: [pageId] });
    await events.settled();
    expect(await versionsOf(pageId)).toEqual([]);
  });
});
