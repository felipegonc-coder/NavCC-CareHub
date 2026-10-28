import { randomUUID } from 'node:crypto';
import type {
  HistoryDoc,
  SavedVersionResponse,
  VersionListResponse,
  VersionResponse,
} from '@carehub/extras/history';
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
import { bindHistoryContent } from './content';
import type { VersionRestoredEvent } from './events';
import { bindHistoryPages, type HistoryPage } from './pages';
import { historyVersions } from './schema';
import { TOO_OLD } from './service';
import { recordEdit, saveDueVersions } from './versions';

const MINUTE = 60 * 1000;

describe.skipIf(!hasDatabase)('the versions API on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let riley: TestUser;
  let casey: TestUser;
  const workspaceId = randomUUID();
  const pages = new Map<string, HistoryPage>();
  const levels = new Map<string, Map<string, AccessLevel>>();
  const docs = new Map<string, HistoryDoc>();
  const restored: VersionRestoredEvent[] = [];
  const updated: unknown[] = [];
  const unbind: (() => void)[] = [];
  /** Pages that get locked right after the next read, as if someone locked them meanwhile. */
  const lockAfterRead = new Set<string>();

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    riley = await createUser(test.db, { name: 'Riley Chen', email: 'riley.chen@example.test' });
    casey = await createUser(test.db, { name: 'Casey Park', email: 'casey.park@example.test' });
    unbind.push(
      bindHistoryPages({
        getPage: async (_db, id) => {
          const page = pages.get(id) ?? null;
          if (page && lockAfterRead.delete(id)) pages.set(id, { ...page, locked: true });
          return page;
        },
        getPageAccess: async (_db, userId, id) => levels.get(id)?.get(userId) ?? 'none',
        setPageLook: async (_tx, id, look) => {
          const page = pages.get(id);
          if (page) pages.set(id, { ...page, ...look });
        },
      }),
      bindHistoryContent({
        getPageContent: async (_db, id) => docs.get(id) ?? { type: 'doc', content: [] },
        setPageContent: async (_tx, id, doc) => {
          docs.set(id, doc);
        },
      }),
    );
    unbind.push(
      test.app.events.on('history.version.restored', (event) => void restored.push(event)),
    );
    const loose = test.app.events as unknown as {
      on(name: string, handler: (payload: unknown) => void): () => void;
    };
    unbind.push(loose.on('page.updated', (payload) => void updated.push(payload)));
  });
  afterAll(async () => {
    for (const off of unbind) off();
    await test?.close();
  });

  const paragraph = (text: string): HistoryDoc => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  const textOf = (doc: HistoryDoc) => doc.content[0]?.content?.[0]?.text;

  /** Avery and Sam can edit, Riley can view, Casey has no access. */
  function newPage(title: string, text: string, fields: Partial<HistoryPage> = {}): string {
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
        [sam.id, 'edit'],
        [riley.id, 'view'],
      ]),
    );
    docs.set(id, paragraph(text));
    return id;
  }
  /** `user` types `text` at `at`, and the automatic version is saved 3 minutes later. */
  async function typeAndPause(pageId: string, user: TestUser, text: string, at: Date) {
    docs.set(pageId, paragraph(text));
    await recordEdit(test.db, pageId, [user.id], at);
    const saved = await saveDueVersions(test.db, new Date(at.getTime() + 3 * MINUTE));
    const version = saved.find((one) => one.pageId === pageId);
    if (!version) throw new Error('No version was saved.');
    return version;
  }
  const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    injectAs(test.app, user, { method, url, ...(payload ? { payload } : {}) });
  const versionsUrl = (pageId: string) => `/api/history/pages/${pageId}/versions`;

  it('lists versions newest first, naming everyone who edited', async () => {
    const pageId = newPage('Refund steps', 'Step 1');
    const start = new Date(Date.now() - 60 * MINUTE);
    await typeAndPause(pageId, avery, 'Step 1, step 2', start);
    await recordEdit(test.db, pageId, [sam.id], new Date(start.getTime() + 10 * MINUTE));
    await typeAndPause(
      pageId,
      avery,
      'Step 1, step 2, step 3',
      new Date(start.getTime() + 11 * MINUTE),
    );

    const response = await call(avery, 'GET', versionsUrl(pageId));
    expect(response.statusCode).toBe(200);
    const body = response.json() as VersionListResponse;
    expect(body.canRestore).toBe(true);
    expect(body.nextCursor).toBeNull();
    expect(body.versions.map((version) => version.editors.map((person) => person.name))).toEqual([
      ['Sam Ortiz', 'Avery Lin'],
      ['Avery Lin'],
    ]);
    expect(body.versions[0]).toMatchObject({ kind: 'automatic', name: null, createdBy: null });

    const first = (await call(avery, 'GET', `${versionsUrl(pageId)}?limit=1`)).json();
    expect(first.versions).toHaveLength(1);
    const rest = (
      await call(avery, 'GET', `${versionsUrl(pageId)}?limit=1&before=${first.nextCursor}`)
    ).json() as VersionListResponse;
    expect(rest.versions.map((version) => version.id)).toEqual([body.versions[1]!.id]);
    expect(rest.nextCursor).toBeNull();
  });

  it('shows a version with the one before it, for Show changes', async () => {
    const pageId = newPage('Intake', 'Ask for the name.');
    const start = new Date(Date.now() - 60 * MINUTE);
    await typeAndPause(pageId, sam, 'Ask for the name.', start);
    const second = await typeAndPause(
      pageId,
      sam,
      'Ask for the name and the date of birth.',
      new Date(start.getTime() + 10 * MINUTE),
    );
    const response = await call(sam, 'GET', `${versionsUrl(pageId)}/${second.id}`);
    expect(response.statusCode).toBe(200);
    const body = response.json() as VersionResponse;
    expect(body.version.id).toBe(second.id);
    expect(body.page.title).toBe('Intake');
    expect(textOf(body.page.content)).toBe('Ask for the name and the date of birth.');
    expect(textOf(body.previous!.page.content)).toBe('Ask for the name.');
  });

  it('HT-15: refuses versions without Can edit, never showing the title', async () => {
    const pageId = newPage('Payroll exceptions', 'Private.');
    const version = await typeAndPause(
      pageId,
      avery,
      'Private notes.',
      new Date(Date.now() - 9 * MINUTE),
    );
    const requests: [string, 'GET' | 'POST' | 'PATCH', string, object?][] = [
      ['list', 'GET', versionsUrl(pageId)],
      ['one', 'GET', `${versionsUrl(pageId)}/${version.id}`],
      ['save', 'POST', versionsUrl(pageId), { reason: 'replace' }],
      ['name', 'PATCH', `${versionsUrl(pageId)}/${version.id}`, { name: 'Before payroll' }],
      ['restore', 'POST', `${versionsUrl(pageId)}/${version.id}/restore`],
    ];
    for (const user of [riley, casey]) {
      for (const [what, method, url, payload] of requests) {
        const response = await call(user, method, url, payload);
        expect(response.statusCode, what).toBe(403);
        expect(response.json()).toEqual({
          error: { code: 'forbidden', message: "You don't have access to this." },
        });
        expect(response.body).not.toContain('Payroll');
      }
    }
    expect((await call(avery, 'GET', versionsUrl(randomUUID()))).statusCode).toBe(404);
    expect((await call(avery, 'GET', '/api/history/pages/not-a-page/versions')).statusCode).toBe(
      404,
    );
    const inTrash = newPage('Old memo', 'Gone.', { trashed: true });
    expect((await call(avery, 'GET', versionsUrl(inTrash))).statusCode).toBe(404);
  });

  it('says a missing version is too old to show', async () => {
    const pageId = newPage('Hours', 'Mon to Fri.');
    const other = newPage('Holidays', 'Nov 26.');
    const elsewhere = await typeAndPause(
      other,
      sam,
      'Nov 26 and 27.',
      new Date(Date.now() - 9 * MINUTE),
    );
    const response = await call(avery, 'GET', `${versionsUrl(pageId)}/${elsewhere.id}`);
    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toBe(TOO_OLD);
  });

  it('names, renames and un-names versions, up to 100 per page', async () => {
    const pageId = newPage('Policy', 'Version one.');
    const version = await typeAndPause(
      pageId,
      avery,
      'Version two.',
      new Date(Date.now() - 9 * MINUTE),
    );
    const url = `${versionsUrl(pageId)}/${version.id}`;
    const named = await call(avery, 'PATCH', url, { name: '  Before the Nov policy change ' });
    expect(named.statusCode).toBe(200);
    expect((named.json() as SavedVersionResponse).version.name).toBe(
      'Before the Nov policy change',
    );
    expect((await call(sam, 'PATCH', url, { name: 'Nov policy' })).json().version.name).toBe(
      'Nov policy',
    );
    expect((await call(sam, 'PATCH', url, { name: '' })).json().version.name).toBeNull();
    expect((await call(sam, 'PATCH', url, { name: 'x'.repeat(101) })).statusCode).toBe(400);

    await test.db.insert(historyVersions).values(
      Array.from({ length: 100 }, (_, index) => ({
        pageId,
        workspaceId,
        kind: 'automatic' as const,
        name: `Checkpoint ${index + 1}`,
        content: paragraph('Old.'),
        digest: `digest-${index}`,
        size: 10,
        createdAt: new Date(Date.now() - (index + 20) * MINUTE),
      })),
    );
    const full = await call(avery, 'PATCH', url, { name: 'One more' });
    expect(full.statusCode).toBe(409);
    expect(full.json().error.message).toBe(
      'This page has 100 named versions. Remove a name first.',
    );
  });

  it('HT-05: a restore saves the page first, puts the version back and tells everyone', async () => {
    const pageId = newPage('Refund steps', 'Call the bank.');
    const old = await typeAndPause(
      pageId,
      avery,
      'Call the bank.',
      new Date(Date.now() - 30 * MINUTE),
    );
    // Sam is typing when Avery restores.
    pages.set(pageId, { ...pages.get(pageId)!, title: 'Refund steps (draft)' });
    docs.set(pageId, paragraph('Email the bank.'));
    await recordEdit(test.db, pageId, [sam.id], new Date(Date.now() - 1000));

    const response = await call(avery, 'POST', `${versionsUrl(pageId)}/${old.id}/restore`);
    expect(response.statusCode).toBe(200);
    const { version } = response.json() as SavedVersionResponse;
    expect(version).toMatchObject({
      kind: 'before_restore',
      createdBy: { id: avery.id, name: 'Avery Lin' },
      editors: [{ id: sam.id, name: 'Sam Ortiz' }],
      restoredFrom: old.createdAt.toISOString(),
    });
    expect(textOf(docs.get(pageId)!)).toBe('Call the bank.');
    expect(pages.get(pageId)!.title).toBe('Refund steps');

    // Sam's text is in the version saved just before.
    const saved = (await call(sam, 'GET', `${versionsUrl(pageId)}/${version.id}`)).json();
    expect(textOf(saved.page.content)).toBe('Email the bank.');
    expect(saved.page.title).toBe('Refund steps (draft)');
    const list = (await call(sam, 'GET', versionsUrl(pageId))).json() as VersionListResponse;
    expect(list.versions.map((one) => one.kind)).toEqual(['before_restore', 'automatic']);

    await test.app.events.settled();
    expect(restored).toContainEqual({
      pageId,
      workspaceId,
      versionId: version.id,
      restoredVersionId: old.id,
      by: avery.id,
    });
    expect(updated).toContainEqual(
      expect.objectContaining({ pageId, by: avery.id, content: true }),
    );
    // The restore's own write starts no automatic version.
    const later = await saveDueVersions(test.db, new Date(Date.now() + 5 * MINUTE));
    expect(later.filter((one) => one.pageId === pageId)).toEqual([]);
  });

  it("won't restore or name versions of locked or archived pages", async () => {
    for (const [fields, message] of [
      [{ locked: true }, 'This page is locked. Unlock it first.'],
      [{ archivedAt: new Date() }, 'This page is archived. Unarchive it first.'],
    ] as const) {
      const pageId = newPage('Scripts', 'Hello.');
      const version = await typeAndPause(
        pageId,
        avery,
        'Hello there.',
        new Date(Date.now() - 9 * MINUTE),
      );
      pages.set(pageId, { ...pages.get(pageId)!, ...fields });
      const list = (await call(avery, 'GET', versionsUrl(pageId))).json() as VersionListResponse;
      expect(list.canRestore).toBe(false);
      for (const [method, url, payload] of [
        ['POST', `${versionsUrl(pageId)}/${version.id}/restore`, undefined],
        ['PATCH', `${versionsUrl(pageId)}/${version.id}`, { name: 'Keep' }],
      ] as const) {
        const response = await call(avery, method, url, payload);
        expect(response.statusCode).toBe(403);
        expect(response.json().error.message).toBe(message);
      }
    }
  });

  it('checks the lock again inside the restore', async () => {
    const pageId = newPage('Intake checklist', 'Step one.');
    const version = await typeAndPause(
      pageId,
      avery,
      'Step one, then two.',
      new Date(Date.now() - 9 * MINUTE),
    );
    docs.set(pageId, paragraph('Step one, two and three.'));
    lockAfterRead.add(pageId);
    const response = await call(avery, 'POST', `${versionsUrl(pageId)}/${version.id}/restore`);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe('This page is locked. Unlock it first.');
    expect(textOf(docs.get(pageId)!)).toBe('Step one, two and three.');
    const list = (await call(avery, 'GET', versionsUrl(pageId))).json() as VersionListResponse;
    expect(list.versions.map((one) => one.id)).toEqual([version.id]);
  });

  it('HT-02: saves a version before Replace all, once per change', async () => {
    const pageId = newPage('Phone tree', 'Press 1 for billing.');
    const first = await call(sam, 'POST', versionsUrl(pageId), { reason: 'replace' });
    expect(first.statusCode).toBe(201);
    const { version } = first.json() as SavedVersionResponse;
    expect(version).toMatchObject({ kind: 'before_replace', createdBy: { name: 'Sam Ortiz' } });
    const again = await call(sam, 'POST', versionsUrl(pageId), { reason: 'accept_all' });
    expect(again.json().version.id).toBe(version.id);
    expect((await call(sam, 'POST', versionsUrl(pageId), { reason: 'import' })).statusCode).toBe(
      400,
    );
  });
});
