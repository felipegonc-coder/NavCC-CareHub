import { randomUUID } from 'node:crypto';
import { utf8 } from '@carehub/databases/xlsx/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  type TestApp,
  type TestUser,
} from '../../../testing';
import { cancelJob, scheduleJob, type JobProgress } from '../../jobs';
import { cleanUpImports, endImport, runImport } from './job';
import { bindImportPorts } from './ports';
import {
  findImport,
  insertImport,
  listItems,
  loadUpload,
  moveImport,
  saveUpload,
  type NewImport,
} from './store';

const workspaceId = randomUUID();
const spaceId = randomUUID();
const note = utf8('# Visit notes\n\nBring the blue folder.\n');
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);
/** A kind nothing handles here, so its jobs stay queued. */
const HELD = 'import-export.test-held';

describe.skipIf(!hasDatabase)('the import job on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let unbind: () => void;
  let made: string[] = [];
  /** Runs while the job makes a page. */
  let onCreate: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    unbind = bindImportPorts({
      privateSpace: async () => ({ workspaceId, spaceId }),
      canCreatePages: async () => true,
      createPage: async (_tx, { title }) => {
        await onCreate?.();
        made.push(title);
        return { id: randomUUID() };
      },
      setMarkdown: async () => {},
    });
  });
  afterAll(async () => {
    unbind?.();
    await test?.close();
  });

  /** An import into Private, in `status`, with its upload unless it's null. */
  async function newImport(change: Partial<NewImport> = {}, bytes: Uint8Array | null = note) {
    const row = await insertImport(test.db, {
      workspaceId,
      userId: avery.id,
      source: 'markdown',
      fileName: 'Visit notes.md',
      fileSize: note.length,
      pageId: null,
      spaceId,
      status: 'waiting',
      ...change,
    });
    if (bytes) await test.db.transaction((tx) => saveUpload(tx, row.id, bytes));
    return row;
  }
  const run = (importId: string, signal = new AbortController().signal) => {
    const progress: JobProgress[] = [];
    const setProgress = (value: JobProgress) => void progress.push(value);
    return { progress, done: runImport(test.db, { importId }, { signal, setProgress }) };
  };

  it('writes the pages and the import together, then drops the upload', async () => {
    made = [];
    const row = await newImport();
    const { progress, done } = run(row.id);
    await done;
    expect(await findImport(test.db, row.id)).toMatchObject({
      status: 'done',
      counts: { pages: 1, databases: 0, rows: 0, files: 0 },
      problemCount: 0,
      error: null,
    });
    expect(made).toEqual(['Visit notes']);
    expect(await listItems(test.db, row.id)).toMatchObject([
      { parentId: null, kind: 'page', title: 'Visit notes' },
    ]);
    expect(progress.at(-1)).toEqual({ done: 1, total: 1 });
    expect(await loadUpload(test.db, row.id)).toBeNull();
  });

  it('does nothing for an import that has ended', async () => {
    made = [];
    const row = await newImport({ status: 'cancelled' });
    await run(row.id).done;
    expect((await findImport(test.db, row.id))?.status).toBe('cancelled');
    expect(made).toEqual([]);
    const ctx = { signal: new AbortController().signal, setProgress: () => {} };
    await expect(runImport(test.db, { importId: 'nope' }, ctx)).rejects.toThrow();
  });

  it("stops with the reason when the upload is missing or can't be read", async () => {
    const missing = await newImport({}, null);
    await run(missing.id).done;
    expect(await findImport(test.db, missing.id)).toMatchObject({
      status: 'failed',
      error: 'The import stopped: the file is missing; try again. Nothing was added.',
    });
    const broken = await newImport({ fileName: 'handbook.zip' }, utf8('not a zip'));
    await run(broken.id).done;
    expect(await findImport(test.db, broken.id)).toMatchObject({
      status: 'failed',
      error: "The import stopped: the file isn't a zip. Nothing was added.",
    });
    expect(await loadUpload(test.db, broken.id)).toBeNull();
  });

  it('rolls back what it wrote when the import is cancelled meanwhile (IE-11)', async () => {
    const row = await newImport();
    onCreate = async () => {
      await moveImport(test.db, row.id, ['running'], {
        status: 'cancelled',
        finishedAt: new Date(),
      });
    };
    try {
      await run(row.id).done;
    } finally {
      onCreate = null;
    }
    expect(await findImport(test.db, row.id)).toMatchObject({ status: 'cancelled', counts: null });
    expect(await listItems(test.db, row.id)).toEqual([]);
  });

  it('leaves a stopped run to the runner, which ends it after the last try', async () => {
    const row = await newImport();
    const stopped = new AbortController();
    stopped.abort(new DOMException('The job was stopped (shutdown).', 'AbortError'));
    await expect(run(row.id, stopped.signal).done).rejects.toThrow();
    expect((await findImport(test.db, row.id))?.status).toBe('running');
    await endImport(test.db, row.id, {
      status: 'failed',
      error: 'The import stopped: something went wrong. Nothing was added.',
    });
    expect((await findImport(test.db, row.id))?.status).toBe('failed');
    expect(await loadUpload(test.db, row.id)).toBeNull();

    const late = await newImport();
    const timedOut = new AbortController();
    timedOut.abort(new DOMException('The job was stopped (timeout).', 'TimeoutError'));
    await run(late.id, timedOut.signal).done;
    expect(await findImport(test.db, late.id)).toMatchObject({
      status: 'failed',
      error: 'The import stopped: it took too long. Nothing was added.',
    });
  });

  it("stops when the person can't add pages there any more", async () => {
    const elsewhere = await newImport({ spaceId: randomUUID() });
    await run(elsewhere.id).done;
    expect(await findImport(test.db, elsewhere.id)).toMatchObject({
      status: 'failed',
      error: "The import stopped: you can't add pages there any more. Nothing was added.",
    });
  });

  it('cleans up uploads that never came and imports whose job is gone', async () => {
    const neverSent = await newImport({ status: 'uploading', createdAt: minutesAgo(61) }, null);
    const sending = await newImport({ status: 'uploading', createdAt: minutesAgo(5) }, null);
    const lost = await newImport({ createdAt: minutesAgo(11) });
    const fresh = await newImport({ createdAt: minutesAgo(1) });
    const queued = await scheduleJob({ kind: HELD, payload: {}, ownerUserId: avery.id });
    const inLine = await newImport({ createdAt: minutesAgo(11), jobId: queued.jobId });
    const stoppedJob = await scheduleJob({ kind: HELD, payload: {}, ownerUserId: avery.id });
    await cancelJob(stoppedJob.jobId);
    const cancelled = await newImport({ createdAt: minutesAgo(11), jobId: stoppedJob.jobId });
    const ended = await newImport({ status: 'done', finishedAt: minutesAgo(30) });

    await cleanUpImports(test.db);

    const statusOf = async (id: string) => (await findImport(test.db, id))?.status;
    expect(await findImport(test.db, neverSent.id)).toMatchObject({
      status: 'failed',
      error: "The import stopped: the file didn't finish uploading. Nothing was added.",
    });
    expect(await statusOf(sending.id)).toBe('uploading');
    expect(await findImport(test.db, lost.id)).toMatchObject({
      status: 'failed',
      error: 'The import stopped: something went wrong. Nothing was added.',
    });
    expect(await loadUpload(test.db, lost.id)).toBeNull();
    expect(await statusOf(fresh.id)).toBe('waiting');
    expect(await loadUpload(test.db, fresh.id)).not.toBeNull();
    expect(await statusOf(inLine.id)).toBe('waiting');
    expect(await statusOf(cancelled.id)).toBe('cancelled');
    expect(await loadUpload(test.db, ended.id)).toBeNull();
  });
});
