import { randomUUID } from 'node:crypto';
import type { HistoryDoc } from '@carehub/extras/history';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp, type TestUser } from '../../testing';
import { bindHistoryContent } from './content';
import { recordUpdates, saveVersionNow } from './index';
import { bindHistoryPages, type HistoryPage } from './pages';
import { deleteExpiredVersions } from './retention';
import { historyUpdates, historyVersions } from './schema';
import { forgetPages, recordEdit, saveDueVersions } from './versions';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

type LooseEvents = { emit(name: string, payload: unknown): void };

describe.skipIf(!hasDatabase)('Updates entries on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  const workspaceId = randomUUID();
  const pages = new Map<string, HistoryPage>();
  const docs = new Map<string, HistoryDoc>();
  const unbind: (() => void)[] = [];

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin' });
    sam = await createUser(test.db, { name: 'Sam Ortiz' });
    unbind.push(
      bindHistoryPages({ getPage: async (_db, id) => pages.get(id) ?? null }),
      bindHistoryContent({
        getPageContent: async (_db, id) => docs.get(id) ?? { type: 'doc', content: [] },
        setPageContent: async (_tx, id, doc) => void docs.set(id, doc),
      }),
    );
  });
  afterAll(async () => {
    for (const off of unbind) off();
    await test?.close();
  });

  const paragraphs = (...texts: string[]): HistoryDoc => ({
    type: 'doc',
    content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  });
  function newPage(title: string): string {
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
    });
    docs.set(id, paragraphs('Step 1'));
    return id;
  }
  const entriesOf = (pageId: string) =>
    test.db
      .select()
      .from(historyUpdates)
      .where(eq(historyUpdates.pageId, pageId))
      .orderBy(asc(historyUpdates.createdAt), asc(historyUpdates.kind));
  const emit = async (name: string, payload: unknown) => {
    (test.app.events as unknown as LooseEvents).emit(name, payload);
    await test.app.events.settled();
  };
  /** `userIds` edit at `at`; the automatic version is saved 3 minutes later. */
  async function editAndPause(pageId: string, userIds: string[], doc: HistoryDoc, at: Date) {
    docs.set(pageId, doc);
    await recordEdit(test.db, pageId, userIds, at);
    const saved = await saveDueVersions(test.db, new Date(at.getTime() + 3 * MINUTE));
    const version = saved.find((one) => one.pageId === pageId);
    if (!version) throw new Error('No version was saved.');
    return version;
  }

  it('HT-08: an edited entry for each person in a version, counting its changes', async () => {
    const pageId = newPage('Refund steps');
    const start = new Date(Date.now() - 60 * MINUTE);
    const first = await editAndPause(pageId, [avery.id], paragraphs('Step 1'), start);
    const second = await editAndPause(
      pageId,
      [sam.id, avery.id],
      paragraphs('Step 1', 'Step 2', 'Step 3'),
      new Date(start.getTime() + 20 * MINUTE),
    );
    const entries = (await entriesOf(pageId)).map(({ kind, actorId, details, versionId }) => ({
      kind,
      actorId,
      details,
      versionId,
    }));
    // The first version has nothing before it, so its entry has no count.
    expect(entries[0]).toEqual({
      kind: 'edited',
      actorId: avery.id,
      details: {},
      versionId: first.id,
    });
    expect(entries.slice(1)).toEqual(
      expect.arrayContaining(
        [sam.id, avery.id].map((actorId) => ({
          kind: 'edited',
          actorId,
          details: { changes: 2 },
          versionId: second.id,
        })),
      ),
    );
    expect(entries).toHaveLength(3);
  });

  it('counts edits saved in a version before a template, with that version', async () => {
    const pageId = newPage('Intake checklist');
    docs.set(pageId, paragraphs('Step 1', 'Ask for the member ID'));
    await recordEdit(test.db, pageId, [sam.id], new Date());
    const before = await test.db.transaction((tx) =>
      saveVersionNow(tx, pageId, { reason: 'template', by: avery.id }),
    );
    const [entry] = await entriesOf(pageId);
    expect(entry).toMatchObject({ kind: 'edited', actorId: sam.id, versionId: before?.id });
  });

  it("records renames, moves, locks, sharing, archiving and Trash from the page model's events", async () => {
    const pageId = newPage('Phone tree');
    const parentId = randomUUID();
    const by = avery.id;
    await emit('page.created', { pageId, workspaceId, by });
    await emit('page.updated', { pageId, by, title: { from: 'Phone tree', to: 'Phone menu' } });
    await emit('page.updated', { pageId, by, parentId: { from: null, to: parentId } });
    await emit('page.updated', { pageId, by, locked: true });
    await emit('page.updated', { pageId, by, locked: false });
    await emit('access.changed', { pageId, by });
    await emit('page.archived', { pageId, pageIds: [pageId], by });
    await emit('page.unarchived', { pageId, pageIds: [pageId], by });
    await emit('page.trashed', { pageId, by });
    await emit('page.restored', { pageId, by });
    // Nothing to show: content saves, a title set to itself, payloads that aren't page events.
    await emit('page.updated', { pageId, by, content: true, source: 'history.restore' });
    await emit('page.updated', { pageId, by, title: { from: 'Phone menu', to: 'Phone menu' } });
    await emit('page.updated', { pageId: 'not-a-page', by, locked: true });
    await emit('page.trashed', 'nope');

    const entries = await entriesOf(pageId);
    expect(entries.map((entry) => entry.kind).sort()).toEqual(
      [
        'archived',
        'created',
        'locked',
        'moved',
        'renamed',
        'shared',
        'trashed',
        'unarchived',
        'unlocked',
        'untrashed',
      ].sort(),
    );
    expect(
      entries.every((entry) => entry.actorId === by && entry.workspaceId === workspaceId),
    ).toBe(true);
    expect(entries.find((entry) => entry.kind === 'renamed')?.details).toEqual({
      title: { from: 'Phone tree', to: 'Phone menu' },
    });
    expect(entries.find((entry) => entry.kind === 'moved')?.details).toEqual({
      move: { from: null, to: parentId },
    });
  });

  it('records comments, replies and restores', async () => {
    const pageId = newPage('Refund policy');
    const comment = { commentId: randomUUID(), threadId: randomUUID(), pageId, workspaceId };
    test.app.events.emit('comment.created', { ...comment, by: sam.id, newThread: true });
    test.app.events.emit('comment.created', { ...comment, by: avery.id, newThread: false });
    const restoredFrom = new Date(Date.now() - 7 * DAY);
    const saved = await test.db.transaction((tx) =>
      saveVersionNow(tx, pageId, { reason: 'restore', by: avery.id }),
    );
    if (!saved) throw new Error('No version was saved.');
    await test.db
      .update(historyVersions)
      .set({ restoredVersionId: randomUUID(), restoredFrom })
      .where(eq(historyVersions.id, saved.id));
    test.app.events.emit('history.version.restored', {
      pageId,
      workspaceId,
      versionId: saved.id,
      restoredVersionId: randomUUID(),
      by: avery.id,
    });
    await test.app.events.settled();

    const entries = await entriesOf(pageId);
    expect(entries.map(({ kind, actorId, details }) => ({ kind, actorId, details }))).toEqual(
      expect.arrayContaining([
        { kind: 'commented', actorId: sam.id, details: {} },
        { kind: 'commented', actorId: avery.id, details: { reply: true } },
        {
          kind: 'restored',
          actorId: avery.id,
          details: { restoredFrom: restoredFrom.toISOString() },
        },
      ]),
    );
    expect(entries).toHaveLength(3);
  });

  it("adds other features' entries in their transaction", async () => {
    const pageId = newPage('Visit row');
    const change = {
      pageId,
      workspaceId,
      kind: 'property_changed' as const,
      by: sam.id,
      details: { property: { id: 'status', name: 'Status', from: 'Open', to: 'Done' } },
    };
    await expect(
      test.db.transaction(async (tx) => {
        await recordUpdates(tx, [change]);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await entriesOf(pageId)).toEqual([]);

    await test.db.transaction((tx) =>
      recordUpdates(tx, [change, { pageId, workspaceId, kind: 'suggestion_accepted', by: null }]),
    );
    const entries = await entriesOf(pageId);
    expect(
      entries
        .map(({ kind, actorId }) => ({ kind, actorId }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
    ).toEqual([
      { kind: 'property_changed', actorId: sam.id },
      { kind: 'suggestion_accepted', actorId: null },
    ]);
  });

  it('HT-03: deletes entries with the versions of their time, and HT-11 with the page', async () => {
    const pageId = newPage('Old memo');
    const now = new Date();
    const old = new Date(now.getTime() - 400 * DAY);
    const recent = new Date(now.getTime() - 10 * DAY);
    await recordUpdates(test.db, [
      { pageId, workspaceId, kind: 'renamed', by: sam.id, at: old },
      { pageId, workspaceId, kind: 'locked', by: sam.id, at: recent },
    ]);
    // Without a setting, a workspace keeps unnamed versions, and so entries, a year.
    await deleteExpiredVersions(test.db, now);
    expect((await entriesOf(pageId)).map((entry) => entry.kind)).toEqual(['locked']);

    await forgetPages(test.db, [pageId]);
    expect(await entriesOf(pageId)).toEqual([]);
  });
});
