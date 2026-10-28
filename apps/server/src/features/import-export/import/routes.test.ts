import { randomUUID } from 'node:crypto';
import { utf8, zipFile } from '@carehub/databases/xlsx/fixtures';
import type { ImportView, UndoPreview } from '@carehub/extras/import-export/import/index';
import type { AccessLevel } from '@carehub/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../../testing';
import { drainJobsForTest, pauseJobsForTest } from '../../jobs/testing';
import { bindImportPorts } from './ports';
import importRoutes, { OPEN_MAX } from './routes';
import { ieImportUploads, ieImports } from './schema';

const URL = '/api/test-imports';
const workspaceId = randomUUID();
const note = utf8('# Visit notes\n\nBring the blue folder.\n');
const handbook = zipFile([
  { name: 'Intake guide.md', data: '# Intake guide\n\nCall the family first.\n' },
  { name: 'Escalations/Escalation steps.md', data: 'Ask the nurse on duty.\n' },
]);

/** The stand-in page model: each page's people and levels, and what imports made. */
const levels = new Map<string, Map<string, AccessLevel>>();
const spaces = new Map<string, string>();
const creators = new Set<string>();
const made: { id: string; title: string; parentId: string | null; spaceId: string | null }[] = [];
const content = new Map<string, string>();
const changed = new Set<string>();
const trashed: string[][] = [];

function page(access: Record<string, AccessLevel>): string {
  const pageId = randomUUID();
  levels.set(pageId, new Map(Object.entries(access)));
  return pageId;
}
const spaceOf = (userId: string) => {
  const spaceId = spaces.get(userId) ?? randomUUID();
  spaces.set(userId, spaceId);
  return spaceId;
};
const runJobs = () => drainJobsForTest({ now: new Date(Date.now() + 5_000) });

describe.skipIf(!hasDatabase)('imports on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let kai: TestUser;
  let careTeam: string;
  let unbind: () => void;
  let resumeJobs: () => Promise<void>;

  beforeAll(async () => {
    test = await createTestApp({
      routes: async (app) => {
        await app.register(importRoutes, { prefix: URL });
      },
    });
    // Jobs run only when a test runs them (runJobs): none may start before the test's next
    // request, such as Cancel or a change of access.
    resumeJobs = await pauseJobsForTest();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    kai = await createUser(test.db, { name: 'Kai Moreno', email: 'kai.moreno@example.test' });
    creators.add(avery.id).add(sam.id);
    careTeam = page({ [avery.id]: 'edit', [sam.id]: 'view' });
    unbind = bindImportPorts({
      pageAccess: async (_db, userId, pageId) => {
        const level = levels.get(pageId)?.get(userId);
        return level ? { workspaceId, level, title: 'Care team' } : null;
      },
      privateSpace: async (_db, userId) => ({ workspaceId, spaceId: spaceOf(userId) }),
      canCreatePages: async (_db, userId) => creators.has(userId),
      createPage: async (_tx, { title, parentId, spaceId }) => {
        const id = randomUUID();
        made.push({ id, title, parentId, spaceId });
        return { id };
      },
      setMarkdown: async (_tx, pageId, markdown) => void content.set(pageId, markdown),
      changedSince: async (_db, pageIds) => pageIds.filter((id) => changed.has(id)),
      trashPages: async (_tx, pageIds) => void trashed.push([...pageIds]),
    });
  });
  afterAll(async () => {
    unbind?.();
    await resumeJobs?.();
    await test?.close();
  });

  const call = (user: TestUser, method: 'GET' | 'POST', url: string, payload?: object) =>
    injectAs(test.app, user, { method, url, ...(payload ? { payload } : {}) });
  const send = (user: TestUser, id: string, bytes: Uint8Array) =>
    injectAs(test.app, user, {
      method: 'PUT',
      url: `${URL}/${id}/file`,
      payload: Buffer.from(bytes),
      headers: { 'content-type': 'application/octet-stream' },
    });
  const view = async (user: TestUser, id: string): Promise<ImportView> =>
    (await call(user, 'GET', `${URL}/${id}`)).json().import;

  interface Start {
    source?: string;
    fileName?: string;
    bytes?: Uint8Array;
    size?: number;
    pageId?: string | null;
    planned?: boolean;
  }
  const startBody = (input: Start) => ({
    source: input.source ?? 'markdown',
    fileName: input.fileName ?? 'Visit notes.md',
    size: input.size ?? (input.bytes ?? note).length,
    pageId: input.pageId === undefined ? careTeam : input.pageId,
    planned: input.planned ?? false,
  });
  async function start(user: TestUser, input: Start = {}): Promise<ImportView> {
    const response = await call(user, 'POST', URL, startBody(input));
    expect(response.statusCode).toBe(201);
    return response.json().import;
  }
  /** Starts an import, sends its file and runs the job. */
  async function importFile(user: TestUser, input: Start = {}): Promise<ImportView> {
    const started = await start(user, input);
    expect((await send(user, started.id, input.bytes ?? note)).statusCode).toBe(200);
    await runJobs();
    return view(user, started.id);
  }
  const madeSince = (count: number) => made.slice(count);

  it('imports a Markdown file under a page (IE-01)', async () => {
    const before = made.length;
    const started = await start(avery);
    expect(started).toMatchObject({
      status: 'uploading',
      source: 'markdown',
      fileName: 'Visit notes.md',
      size: note.length,
      destination: { pageId: careTeam, title: 'Care team' },
      progress: null,
      counts: null,
      canUndo: false,
    });
    const sent = await send(avery, started.id, note);
    expect(sent.statusCode).toBe(200);
    expect(sent.json().import).toMatchObject({ id: started.id, status: 'waiting' });
    await runJobs();
    expect(await view(avery, started.id)).toMatchObject({
      status: 'done',
      counts: { pages: 1, databases: 0, rows: 0, files: 0 },
      problems: [],
      problemCount: 0,
      error: null,
      canUndo: true,
    });
    const [visit] = madeSince(before);
    expect(visit).toMatchObject({ title: 'Visit notes', parentId: careTeam, spaceId: null });
    expect(content.get(visit?.id ?? '')).toContain('Bring the blue folder.');
    const uploads = await test.db
      .select()
      .from(ieImportUploads)
      .where(eq(ieImportUploads.importId, started.id));
    expect(uploads).toEqual([]);
  });

  it('imports into Private', async () => {
    const before = made.length;
    const done = await importFile(avery, { pageId: null });
    expect(done).toMatchObject({ status: 'done', destination: { pageId: null, title: 'Private' } });
    expect(madeSince(before)).toMatchObject([
      { title: 'Visit notes', parentId: null, spaceId: spaceOf(avery.id) },
    ]);
  });

  it("refuses files and places it can't import into", async () => {
    const refused = async (user: TestUser, input: Start, status: number, message?: string) => {
      const response = await call(user, 'POST', URL, startBody(input));
      expect(response.statusCode).toBe(status);
      if (message) expect(response.json().error.message).toBe(message);
    };
    await refused(avery, { fileName: 'notes.pdf' }, 400, 'Pick a .md, .txt or .zip file.');
    await refused(
      avery,
      { source: 'html', fileName: 'page.html' },
      400,
      "This kind of file can't be imported yet.",
    );
    await refused(avery, { size: 0 }, 400);
    await refused(avery, { pageId: randomUUID() }, 404);
    await refused(avery, { pageId: page({ [avery.id]: 'view' }) }, 403);
    await refused(avery, { pageId: page({ [avery.id]: 'edit_content' }) }, 403);
    await refused(sam, {}, 403);
    await refused(kai, { pageId: null }, 403);
  });

  it('shows an import only to the person who started it', async () => {
    const started = await start(avery);
    const url = `${URL}/${started.id}`;
    expect((await call(sam, 'GET', url)).statusCode).toBe(403);
    expect((await send(sam, started.id, note)).statusCode).toBe(403);
    expect((await call(sam, 'POST', `${url}/cancel`)).statusCode).toBe(403);
    expect((await call(sam, 'GET', `${url}/undo`)).statusCode).toBe(403);
    const listed: ImportView[] = (await call(sam, 'GET', URL)).json().imports;
    expect(listed.map((item) => item.id)).not.toContain(started.id);
    expect((await call(avery, 'GET', `${URL}/${randomUUID()}`)).statusCode).toBe(404);
    expect((await call(avery, 'GET', `${URL}/nope`)).statusCode).toBe(404);
    expect((await call(avery, 'GET', url)).statusCode).toBe(200);
  });

  it('takes the file once, and whole', async () => {
    const started = await start(avery);
    const empty = await send(avery, started.id, new Uint8Array());
    expect(empty.statusCode).toBe(400);
    const longer = await send(avery, started.id, Uint8Array.from([...note, 0x0a]));
    expect(longer.statusCode).toBe(400);
    expect(longer.json().error.message).toBe("The file didn't arrive whole. Try again.");
    expect((await send(avery, started.id, note)).statusCode).toBe(200);
    expect((await send(avery, started.id, note)).statusCode).toBe(409);
    await runJobs();
  });

  it('cancels an import before it runs, and nothing is made (IE-11)', async () => {
    const before = made.length;
    const uploading = await start(avery);
    const cancelled = await call(avery, 'POST', `${URL}/${uploading.id}/cancel`);
    expect(cancelled.json().import).toMatchObject({ status: 'cancelled', canUndo: false });
    expect((await send(avery, uploading.id, note)).statusCode).toBe(409);

    const waiting = await start(avery);
    expect((await send(avery, waiting.id, note)).statusCode).toBe(200);
    const url = `${URL}/${waiting.id}/cancel`;
    expect((await call(avery, 'POST', url)).json().import).toMatchObject({ status: 'cancelled' });
    expect((await call(avery, 'POST', url)).statusCode).toBe(200);
    await runJobs();
    expect(await view(avery, waiting.id)).toMatchObject({ status: 'cancelled', counts: null });
    expect(madeSince(before)).toEqual([]);
    const uploads = await test.db
      .select()
      .from(ieImportUploads)
      .where(eq(ieImportUploads.importId, waiting.id));
    expect(uploads).toEqual([]);

    const done = await importFile(avery);
    expect((await call(avery, 'POST', `${URL}/${done.id}/cancel`)).statusCode).toBe(409);
  });

  it("stops with the reason when the file can't be read", async () => {
    const failed = await importFile(avery, { fileName: 'handbook.zip', bytes: utf8('not a zip') });
    expect(failed).toMatchObject({
      status: 'failed',
      error: "The import stopped: the file isn't a zip. Nothing was added.",
      canUndo: false,
    });
  });

  it('stops when the person can no longer add pages there', async () => {
    const before = made.length;
    const pageId = page({ [avery.id]: 'edit' });
    const started = await start(avery, { pageId });
    expect((await send(avery, started.id, note)).statusCode).toBe(200);
    levels.get(pageId)?.set(avery.id, 'view');
    await runJobs();
    expect(await view(avery, started.id)).toMatchObject({
      status: 'failed',
      error: "The import stopped: you can't add pages there any more. Nothing was added.",
    });
    expect(madeSince(before)).toEqual([]);
  });

  it('undoes an import, keeping pages changed since unless asked not to (IE-12)', async () => {
    let before = made.length;
    const first = await importFile(avery, { fileName: 'handbook.zip', bytes: handbook });
    expect(first.counts).toEqual({ pages: 3, databases: 0, rows: 0, files: 0 });
    const id = (title: string) => made.slice(before).find((item) => item.title === title)?.id;
    changed.add(id('Escalation steps') ?? '');
    const preview: UndoPreview = (await call(avery, 'GET', `${URL}/${first.id}/undo`)).json()
      .preview;
    expect(preview).toEqual({
      changed: [
        { pageId: id('Escalations'), title: 'Escalations' },
        { pageId: id('Escalation steps'), title: 'Escalation steps' },
      ],
      unchanged: [{ pageId: id('Intake guide'), title: 'Intake guide' }],
    });
    const undone = await call(avery, 'POST', `${URL}/${first.id}/undo`, {});
    expect(undone.json().import).toMatchObject({ status: 'undone', canUndo: false });
    expect(trashed.at(-1)).toEqual([id('Intake guide')]);
    expect((await call(avery, 'POST', `${URL}/${first.id}/undo`, {})).statusCode).toBe(409);
    expect((await call(avery, 'GET', `${URL}/${first.id}/undo`)).statusCode).toBe(409);

    before = made.length;
    const second = await importFile(avery, { fileName: 'handbook.zip', bytes: handbook });
    changed.add(id('Escalation steps') ?? '');
    const all = await call(avery, 'POST', `${URL}/${second.id}/undo`, { removeChanged: true });
    expect(all.statusCode).toBe(200);
    expect(trashed.at(-1)).toEqual([id('Escalations'), id('Intake guide')]);
  });

  it('undoes only with Edit on the page, for 7 days', async () => {
    const pageId = page({ [avery.id]: 'edit' });
    const done = await importFile(avery, { pageId });
    const url = `${URL}/${done.id}/undo`;
    levels.get(pageId)?.set(avery.id, 'view');
    expect((await call(avery, 'POST', url, {})).statusCode).toBe(403);
    levels.get(pageId)?.set(avery.id, 'edit');
    const longAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await test.db.update(ieImports).set({ finishedAt: longAgo }).where(eq(ieImports.id, done.id));
    expect(await view(avery, done.id)).toMatchObject({ status: 'done', canUndo: false });
    expect((await call(avery, 'POST', url, {})).statusCode).toBe(409);
  });

  it('lists the last imports, newest first, without their problems', async () => {
    const plan = {
      pages: [
        {
          key: 'welcome',
          parent: null,
          title: 'Welcome',
          content: { markdown: 'Hello from the front desk.' },
          source: 'welcome.html',
        },
      ],
      databases: [],
      files: [],
      problems: [{ file: 'logo.gif', what: 'Skipped', why: "It isn't in the zip." }],
    };
    const planned = zipFile([{ name: 'plan.json', data: JSON.stringify(plan) }]);
    const started = await start(sam, {
      source: 'html',
      fileName: 'welcome.html',
      size: 2_048,
      pageId: null,
      planned: true,
    });
    expect((await send(sam, started.id, planned)).statusCode).toBe(200);
    await runJobs();
    expect(await view(sam, started.id)).toMatchObject({
      status: 'done',
      counts: { pages: 1, databases: 0, rows: 0, files: 0 },
      problems: plan.problems,
      problemCount: 1,
    });
    const newer = await start(sam, { pageId: null });
    const listed: ImportView[] = (await call(sam, 'GET', URL)).json().imports;
    expect(listed.map((item) => item.id).slice(0, 2)).toEqual([newer.id, started.id]);
    expect(listed[1]).toMatchObject({ status: 'done', problems: [], problemCount: 1 });
  });

  it(`takes at most ${OPEN_MAX} imports going at once`, async () => {
    const riley = await createUser(test.db, { name: 'Riley Chen' });
    creators.add(riley.id);
    const going: ImportView[] = [];
    for (let n = 0; n < OPEN_MAX; n += 1) going.push(await start(riley, { pageId: null }));
    const refused = await call(riley, 'POST', URL, startBody({ pageId: null }));
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('rate_limited');
    await call(riley, 'POST', `${URL}/${going[0]?.id}/cancel`);
    expect((await call(riley, 'POST', URL, startBody({ pageId: null }))).statusCode).toBe(201);
  });
});
