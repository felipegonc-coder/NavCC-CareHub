// CSV and Excel import on a real database (decision 0200; spec 3.7): the preview, the import job,
// problems, files that can't be read, the worker thread's limits, who may import, and Undo import.
// The worker runs from a bundle of import-worker.ts, as the server's build makes it. Fictional
// people only.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultConfig, newProperty, relationConfig, type Property } from '@carehub/databases';
import { XLSX_ERRORS } from '@carehub/databases/xlsx';
import { xlsxFile } from '@carehub/databases/xlsx/fixtures';
import { sql } from 'drizzle-orm';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { getJob, scheduleJob } from '../jobs';
import { drainJobsForTest } from '../jobs/testing';
import { bindMemoryNotices } from '../notices/testing';
import { createRow, onDatabaseEvent, runRowWrites, updateRows, type DatabaseEvent } from './api';
import { DATABASE_MESSAGES } from './errors';
import { IMPORT_JOB, setImportReader } from './import';
import { IMPORT_MESSAGES } from './import-worker';
import type { DatabaseRecord, DatabaseSettings } from './record';
import { changeDatabase, loadDatabase } from './store';

type Role = 'admin' | 'editor' | 'viewer';
const PERMISSIONS: Record<Role, string[]> = {
  admin: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share', 'workspace.admin'],
  editor: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share'],
  viewer: [],
};
const INVALID_REQUEST = "That request isn't valid.";

const base64 = (data: string | Uint8Array) => Buffer.from(data).toString('base64');
const script = (code: string) => new URL(`data:text/javascript,${encodeURIComponent(code)}`);

// Rows 4 and 5 of the file: an empty row is skipped, and "abc" isn't a number.
const VISITS_CSV = [
  'Name,Hours,Visit,Kind,Assignee,Client,Gate code,Rate',
  'Leak under sink,2.5,2026-10-20,Repair,Jordan Park,Harbor Cafe,1234,40',
  'Frozen pipe,abc,2026-10-21,Repair,,,,',
  ',,,,,,,',
  'Water heater,1,2026-10-22,Install,Avery Lin,,5678,',
].join('\n');

const t = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const n = (ref: string, value: number) => `<c r="${ref}"><v>${value}</v></c>`;

/** A summary sheet first; Call-outs has two empty rows above its header row (row 3). */
const WORKBOOK = xlsxFile({
  sheets: [
    { name: 'Summary', rows: `<row r="1">${t('A1', 'Call-outs by week')}</row>` },
    {
      name: 'Call-outs',
      rows:
        `<row r="3">${t('A3', 'Name')}${t('B3', 'Hours')}</row>` +
        `<row r="4">${t('A4', 'Blocked drain')}${n('B4', 3)}</row>` +
        `<row r="5">${t('A5', 'Burst main')}${t('B5', 'lots')}</row>`,
    },
  ],
});

describe.skipIf(!hasDatabase)('database import', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let notices: ReturnType<typeof bindMemoryNotices>;
  let stopEvents: () => void = () => undefined;
  let restoreReader: () => void = () => undefined;
  let workerDir = '';
  let workerUrl: URL;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  let visitsId: string;
  let clientsId: string;
  let harborId: string;
  let nameId: string;
  const people = {} as Record<'admin' | 'avery' | 'jordan', TestUser>;
  const events: DatabaseEvent[] = [];

  const hours = newProperty('Hours', defaultConfig('number'));
  const visit = newProperty('Visit', defaultConfig('date'));
  const assignee = newProperty('Assignee', defaultConfig('person'));
  const ticket = newProperty('Ticket', defaultConfig('unique_id'));
  let client: Property;
  let gate: Property;
  let rate: Property;

  async function standInWorkspace() {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS roles (id uuid PRIMARY KEY DEFAULT
      gen_random_uuid(), workspace_id uuid NOT NULL, name text NOT NULL, permissions text[] NOT NULL)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS workspace_members (workspace_id uuid NOT NULL,
      user_id uuid NOT NULL, role_id uuid, kind text NOT NULL DEFAULT 'member',
      PRIMARY KEY (workspace_id, user_id))`);
    const { rows } = await db.execute<{ id: string }>(
      sql`INSERT INTO workspaces (name) VALUES ('Blue Pine Plumbing') RETURNING id`,
    );
    workspaceId = rows[0]!.id;
  }

  async function person(role: Role, name: string, email: string): Promise<TestUser> {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO roles (workspace_id, name, permissions)
      VALUES (${workspaceId}, ${`${role} for ${name}`}, ${`{${PERMISSIONS[role].join(',')}}`}::text[])
      RETURNING id`);
    const user = await createUser(db, { name, email });
    await db.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, role_id)
      VALUES (${workspaceId}, ${user.id}, ${rows[0]!.id})`);
    await db.execute(sql`INSERT INTO space_members (space_id, principal_type, principal_id)
      VALUES (${spaceId}, 'user', ${user.id})`);
    return user;
  }

  async function newDatabase(title: string): Promise<string> {
    const res = await injectAs(app, people.admin, {
      method: 'POST',
      url: '/api/databases',
      payload: { parentId: pageId, inline: false, title },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  async function settings(
    id: string,
    change: (current: DatabaseRecord) => Partial<DatabaseSettings>,
  ): Promise<DatabaseRecord> {
    const current = await loadDatabase(db, id);
    if (!current) throw new Error('The test database is missing.');
    return changeDatabase(db, id, current.version, change);
  }

  const post = (who: TestUser, url: string, payload: object = {}) =>
    injectAs(app, who, { method: 'POST', url, payload });
  const get = (who: TestUser, url: string) => injectAs(app, who, { method: 'GET', url });
  const preview = (who: TestUser, payload: object, id = visitsId) =>
    post(who, `/api/databases/${id}/import/preview`, payload);
  const start = (who: TestUser, payload: object, id = visitsId) =>
    post(who, `/api/databases/${id}/import`, payload);
  const csv = (text: string, extra: object = {}) => ({
    fileName: 'visits.csv',
    data: base64(text),
    ...extra,
  });

  async function rowsOf(importId: string) {
    const { rows } = await db.execute<{
      id: string;
      title: string;
      values: Record<string, unknown>;
      unique_number: number | null;
      deleted: boolean;
    }>(sql`
      SELECT p.id, p.title, r."values", r.unique_number, p.deleted_at IS NOT NULL AS deleted
      FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.import_id = ${importId}
      ORDER BY r.unique_number, p.title`);
    return rows;
  }

  async function filesOf(importId: string) {
    const { rows } = await db.execute(
      sql`SELECT 1 FROM db_import_files WHERE import_id = ${importId}`,
    );
    return rows.length;
  }

  /** Starts an import as Avery and runs its job. */
  async function imported(payload: object, id = visitsId) {
    const res = await start(people.avery, payload, id);
    expect(res.statusCode).toBe(202);
    const { importId, jobId } = res.json() as { importId: string; jobId: string };
    await drainJobsForTest();
    await app.events.settled();
    return { importId, jobId };
  }

  beforeAll(async () => {
    workerDir = await mkdtemp(join(tmpdir(), 'carehub-import-worker-'));
    const outfile = join(workerDir, 'import-worker.mjs');
    await build({
      entryPoints: [fileURLToPath(new URL('./import-worker.ts', import.meta.url))],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      logLevel: 'silent',
    });
    workerUrl = pathToFileURL(outfile);
    restoreReader = setImportReader({ url: workerUrl });

    ({ app, db, close } = await createTestApp());
    notices = bindMemoryNotices();
    stopEvents = onDatabaseEvent(app, (event) => {
      events.push(event);
    });
    await standInWorkspace();
    const space = await db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name)
      VALUES (${workspaceId}, 'open', 'Operations') RETURNING id`);
    spaceId = space.rows[0]!.id;
    const page = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, kind, title, position)
      VALUES (${workspaceId}, ${spaceId}, 'page', 'Dispatch', 'a0') RETURNING id`);
    pageId = page.rows[0]!.id;
    people.admin = await person('admin', 'Morgan Reyes', 'morgan@bluepine.example');
    people.avery = await person('editor', 'Avery Lin', 'avery@bluepine.example');
    people.jordan = await person('viewer', 'Jordan Park', 'jordan@bluepine.example');

    visitsId = await newDatabase('Visits');
    clientsId = await newDatabase('Clients');
    client = newProperty('Client', relationConfig(clientsId));
    // Only Morgan sees Gate code; everyone sees Rate, only Morgan changes it.
    gate = {
      ...newProperty('Gate code', defaultConfig('text')),
      access: { see: [{ type: 'user', id: people.admin.id }], change: null },
    };
    rate = {
      ...newProperty('Rate', defaultConfig('number')),
      access: { see: null, change: [{ type: 'user', id: people.admin.id }] },
    };
    const visits = await settings(visitsId, (current) => ({
      properties: [...current.properties, hours, visit, assignee, client, gate, rate, ticket],
    }));
    nameId = visits.properties.find((p) => p.config.type === 'title')!.id;
    const clients = await loadDatabase(db, clientsId);
    const clientName = clients!.properties.find((p) => p.config.type === 'title')!.id;
    ({ rowId: harborId } = await runRowWrites(app, (tx) =>
      createRow(tx, {
        databaseId: clientsId,
        values: { [clientName]: 'Harbor Cafe' },
        actorUserId: people.admin.id,
        source: 'user',
      }),
    ));
  }, 60_000);

  afterAll(async () => {
    restoreReader();
    stopEvents();
    notices?.unbind();
    await close?.();
    if (workerDir) await rm(workerDir, { recursive: true, force: true });
  });

  const SLOW = 30_000;

  it(
    'previews a CSV file: columns with their guessed types, the first rows and the problems',
    async () => {
      const res = await preview(people.avery, csv(VISITS_CSV));
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        kind: 'csv',
        separator: ',',
        sheets: null,
        firstRowIsHeaders: true,
        rowCount: 3,
        problemCount: 1,
        summary: "Imported 3 rows. 1 value couldn't be read.",
      });
      expect(body.columns).toEqual([
        expect.objectContaining({
          header: 'Name',
          target: { kind: 'existing', propertyId: nameId },
        }),
        expect.objectContaining({
          header: 'Hours',
          target: { kind: 'existing', propertyId: hours.id },
          guessedType: 'text',
        }),
        expect.objectContaining({
          header: 'Visit',
          target: { kind: 'existing', propertyId: visit.id },
          guessedType: 'date',
        }),
        expect.objectContaining({
          header: 'Kind',
          target: { kind: 'new', name: 'Kind', type: 'select' },
          guessedType: 'select',
        }),
        expect.objectContaining({ target: { kind: 'existing', propertyId: assignee.id } }),
        expect.objectContaining({ target: { kind: 'existing', propertyId: client.id } }),
        // Avery can't see Gate code, so the column makes a new property beside it.
        expect.objectContaining({
          header: 'Gate code',
          target: { kind: 'new', name: 'Gate code 2', type: 'number' },
        }),
        // Avery can't change Rate.
        expect.objectContaining({ header: 'Rate', target: { kind: 'skip' } }),
      ]);
      expect(
        body.rows.map((r: { rowNumber: number; title: string }) => [r.rowNumber, r.title]),
      ).toEqual([
        [2, 'Leak under sink'],
        [3, 'Frozen pipe'],
        [5, 'Water heater'],
      ]);
      expect(body.rows[0].values).toMatchObject({
        [hours.id]: '2.5',
        [assignee.id]: [people.jordan.id],
        [client.id]: [harborId],
      });
      expect(body.problems).toEqual([
        { row: 3, column: 'Hours', value: 'abc', reason: expect.any(String) },
      ]);
      expect(JSON.stringify(body)).not.toContain(gate.id);
      // A preview writes nothing.
      const { rows } = await db.execute(
        sql`SELECT 1 FROM db_imports WHERE database_id = ${visitsId}`,
      );
      expect(rows).toEqual([]);
    },
    SLOW,
  );

  it(
    'imports in a job: new properties and options, rows in file order, problems and summary',
    async () => {
      const before = events.length;
      const res = await start(people.avery, csv(VISITS_CSV));
      expect(res.statusCode).toBe(202);
      const { importId, jobId } = res.json();
      expect(await filesOf(importId)).toBe(1);
      await drainJobsForTest();
      await app.events.settled();

      expect(await getJob(jobId)).toMatchObject({
        status: 'succeeded',
        result: {
          importId,
          rowCount: 3,
          problemCount: 1,
          summary: "Imported 3 rows. 1 value couldn't be read.",
        },
      });
      const rows = await rowsOf(importId);
      // Ordered by their ID numbers, which follow the file.
      expect(rows.map((r) => r.title)).toEqual(['Leak under sink', 'Frozen pipe', 'Water heater']);
      expect(rows.every((r) => r.unique_number !== null)).toBe(true);
      const record = (await loadDatabase(db, visitsId))!;
      const kind = record.properties.find((p) => p.name === 'Kind');
      const gate2 = record.properties.find((p) => p.name === 'Gate code 2');
      expect(kind?.config).toMatchObject({
        type: 'select',
        options: [
          expect.objectContaining({ name: 'Repair' }),
          expect.objectContaining({ name: 'Install' }),
        ],
      });
      expect(gate2?.config.type).toBe('number');
      // New properties join the views as hidden columns.
      expect(record.views[0]?.properties).toEqual(
        expect.arrayContaining([{ propertyId: kind!.id, visible: false }]),
      );
      expect(rows[0]?.values).toMatchObject({
        [hours.id]: '2.5',
        [assignee.id]: [people.jordan.id],
        [client.id]: [harborId],
        [gate2!.id]: '1234',
      });
      expect(rows[0]?.values).not.toHaveProperty(rate.id);
      expect(rows[1]?.values).not.toHaveProperty(hours.id);

      // The file is gone; the import keeps its problems for the summary and the download.
      expect(await filesOf(importId)).toBe(0);
      const summary = await get(people.avery, `/api/databases/${visitsId}/imports/${importId}`);
      expect(summary.json()).toMatchObject({
        importId,
        fileName: 'visits.csv',
        status: 'done',
        rowCount: 3,
        problemCount: 1,
        summary: "Imported 3 rows. 1 value couldn't be read.",
        error: null,
        undoneAt: null,
      });
      const list = await get(
        people.avery,
        `/api/databases/${visitsId}/imports/${importId}/problems`,
      );
      expect(list.statusCode).toBe(200);
      expect(list.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(list.headers['content-disposition']).toBe(
        'attachment; filename="import-problems.csv"',
      );
      expect(list.body).toContain('Row,Column,Value,Reason');
      expect(list.body).toContain('3,Hours,abc,');

      // Events after the commit, with source 'import'; imports send no Person notices.
      const sent = events.slice(before);
      expect(sent.filter((e) => e.name === 'databases.row.created')).toHaveLength(3);
      expect(sent).toContainEqual({
        name: 'databases.row.created',
        payload: expect.objectContaining({ source: 'import', actorId: people.avery.id }),
      });
      expect(sent).toContainEqual({
        name: 'databases.database.updated',
        payload: {
          workspaceId,
          databaseId: visitsId,
          actorId: people.avery.id,
          what: 'properties',
        },
      });
      expect(notices.store.records.filter((r) => r.userId === people.jordan.id)).toEqual([]);

      // A second run of the same import adds nothing.
      await scheduleJob({ kind: IMPORT_JOB, payload: { importId } });
      await drainJobsForTest();
      expect(await rowsOf(importId)).toHaveLength(3);

      // Only the person who imported it reads it back.
      expect(
        (await get(people.admin, `/api/databases/${visitsId}/imports/${importId}`)).statusCode,
      ).toBe(404);
      expect(
        (await get(people.admin, `/api/databases/${visitsId}/imports/${importId}/problems`))
          .statusCode,
      ).toBe(404);
    },
    SLOW,
  );

  it(
    'imports an Excel sheet with the row numbers of the file',
    async () => {
      const workbook = { fileName: 'call-outs.xlsx', data: base64(WORKBOOK) };
      const first = await preview(people.avery, workbook);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        kind: 'xlsx',
        separator: null,
        sheets: [
          { name: 'Summary', hidden: false },
          { name: 'Call-outs', hidden: false },
        ],
        sheet: 'Summary',
      });

      const picked = await preview(people.avery, { ...workbook, sheet: 'Call-outs' });
      expect(picked.json()).toMatchObject({
        sheet: 'Call-outs',
        rowCount: 2,
        rows: [
          { rowNumber: 4, title: 'Blocked drain', values: { [hours.id]: '3' } },
          { rowNumber: 5, title: 'Burst main' },
        ],
        problems: [{ row: 5, column: 'Hours', value: 'lots', reason: expect.any(String) }],
      });

      const missing = await preview(people.avery, { ...workbook, sheet: 'Q4' });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().error).toEqual({
        code: 'invalid',
        message: IMPORT_MESSAGES.noSheet,
        details: {
          sheets: [
            { name: 'Summary', hidden: false },
            { name: 'Call-outs', hidden: false },
          ],
        },
      });

      const { importId } = await imported({ ...workbook, sheet: 'Call-outs' });
      expect((await rowsOf(importId)).map((r) => r.title)).toEqual(['Blocked drain', 'Burst main']);
      const back = await get(
        people.avery,
        `/api/databases/${visitsId}/imports/${importId}/problems`,
      );
      expect(back.body).toContain('5,Hours,lots,');
    },
    SLOW,
  );

  it(
    'refuses a file it cannot read, and writes nothing',
    async () => {
      const notExcel = await preview(people.avery, {
        fileName: 'visits.xlsx',
        data: base64('Name\nLeak'),
      });
      expect(notExcel.statusCode).toBe(400);
      expect(notExcel.json().error).toEqual({ code: 'invalid', message: XLSX_ERRORS.notXlsx });

      const pdf = await preview(people.avery, { fileName: 'visits.pdf', data: base64('%PDF-1.7') });
      expect(pdf.json().error).toEqual({ code: 'invalid', message: IMPORT_MESSAGES.fileType });

      const notBase64 = await preview(people.avery, {
        fileName: 'visits.csv',
        data: 'Name,Hours!',
      });
      expect(notBase64.json().error).toEqual({ code: 'invalid', message: INVALID_REQUEST });

      const big = await preview(people.avery, {
        fileName: 'visits.csv',
        data: base64(Buffer.alloc(10 * 1024 * 1024 + 1, 'a')),
      });
      expect(big.statusCode).toBe(413);
      expect(big.json().error).toEqual({
        code: 'too_large',
        message: 'This file is larger than 10 MB.',
      });

      // The import job fails with the reader's message; its file is deleted and no row is added.
      const { importId, jobId } = await imported({ fileName: 'visits.xlsx', data: base64('Name') });
      expect(await getJob(jobId)).toMatchObject({ status: 'failed', error: XLSX_ERRORS.notXlsx });
      expect(await filesOf(importId)).toBe(0);
      expect(await rowsOf(importId)).toEqual([]);
      const summary = await get(people.avery, `/api/databases/${visitsId}/imports/${importId}`);
      expect(summary.json()).toMatchObject({
        status: 'failed',
        error: XLSX_ERRORS.notXlsx,
        summary: null,
      });
    },
    SLOW,
  );

  it(
    'answers "This file couldn\'t be read." when the worker runs too long, runs out of memory or stops',
    async () => {
      const unreadable = { code: 'invalid', message: IMPORT_MESSAGES.unreadable };
      const stand = async (
        url: URL,
        limits: { timeoutMs?: number; maxOldGenerationSizeMb?: number },
      ) => {
        const restore = setImportReader({ url, ...limits });
        try {
          return await preview(people.avery, csv(VISITS_CSV));
        } finally {
          restore();
        }
      };
      const slow = await stand(script('setInterval(() => {}, 1000);'), { timeoutMs: 300 });
      expect(slow.json().error).toEqual(unreadable);
      const greedy = await stand(
        script('const keep = []; for (;;) keep.push(new Array(1e5).fill(Math.random()));'),
        { maxOldGenerationSizeMb: 16 },
      );
      expect(greedy.json().error).toEqual(unreadable);
      expect((await stand(script('process.exit(3);'), {})).json().error).toEqual(unreadable);

      // The real reader with too little time: the job fails and nothing is written.
      const restore = setImportReader({ url: workerUrl, timeoutMs: 1 });
      try {
        const { importId, jobId } = await imported(csv(VISITS_CSV));
        expect(await getJob(jobId)).toMatchObject({
          status: 'failed',
          error: IMPORT_MESSAGES.unreadable,
        });
        expect(await rowsOf(importId)).toEqual([]);
        expect(await filesOf(importId)).toBe(0);
      } finally {
        restore();
      }
    },
    SLOW,
  );

  it(
    'needs Can edit with Lock structure off, and a plan that fits the database',
    async () => {
      const viewer = await preview(people.jordan, csv(VISITS_CSV));
      expect(viewer.statusCode).toBe(403);
      expect((await start(people.jordan, csv(VISITS_CSV))).statusCode).toBe(403);

      await settings(visitsId, () => ({ locked: true }));
      try {
        const locked = await preview(people.avery, csv(VISITS_CSV));
        expect(locked.statusCode).toBe(403);
        expect(locked.json().error).toEqual({
          code: 'forbidden',
          message: DATABASE_MESSAGES.locked,
        });
      } finally {
        await settings(visitsId, () => ({ locked: false }));
      }

      // Locked after the import started: the job refuses with the same message.
      const res = await start(people.avery, csv(VISITS_CSV));
      const { importId, jobId } = res.json();
      await settings(visitsId, () => ({ locked: true }));
      try {
        await drainJobsForTest();
        expect(await getJob(jobId)).toMatchObject({
          status: 'failed',
          error: DATABASE_MESSAGES.locked,
        });
        expect(await rowsOf(importId)).toEqual([]);
      } finally {
        await settings(visitsId, () => ({ locked: false }));
      }

      // A column can't fill a property Avery can't change, or one she can't see.
      const plan = (target: object) => ({
        columns: [
          { index: 0, header: 'Name', target: { kind: 'existing', propertyId: nameId } },
          { index: 1, header: 'Hours', target },
        ],
      });
      for (const target of [
        { kind: 'existing', propertyId: rate.id },
        { kind: 'existing', propertyId: gate.id },
        { kind: 'new', name: 'Gate code', type: 'text' },
        { kind: 'existing', propertyId: nameId },
      ]) {
        const refused = await preview(people.avery, csv(VISITS_CSV, plan(target)));
        expect(refused.statusCode).toBe(400);
        expect(refused.json().error).toEqual({ code: 'invalid', message: IMPORT_MESSAGES.plan });
      }
      const fits = await preview(people.avery, csv(VISITS_CSV, plan({ kind: 'skip' })));
      expect(fits.statusCode).toBe(200);
      expect(fits.json().columns).toHaveLength(2);
    },
    SLOW,
  );

  it(
    'undoes an import: its rows go to Trash, unless some changed since',
    async () => {
      const two = ['Name,Hours', 'Dripping tap,1', 'Noisy boiler,2'].join('\n');
      const { importId } = await imported(csv(two));
      const [, boiler] = await rowsOf(importId);
      const undo = (who: TestUser, id = importId) =>
        post(who, `/api/databases/${visitsId}/imports/${id}/undo`);

      await runRowWrites(app, (tx) =>
        updateRows(tx, {
          databaseId: visitsId,
          rowIds: [boiler!.id],
          values: { [hours.id]: '3' },
          actorUserId: people.admin.id,
          source: 'user',
        }),
      );
      const refused = await undo(people.avery);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error).toEqual({
        code: 'conflict',
        message: IMPORT_MESSAGES.changedSince,
        details: { rowIds: [boiler!.id], count: 1 },
      });
      expect((await rowsOf(importId)).every((r) => !r.deleted)).toBe(true);

      // A fresh import undoes: exactly its rows go to Trash.
      const again = await imported(csv(two));
      const before = events.length;
      expect((await undo(people.admin, again.importId)).statusCode).toBe(404);
      const done = await undo(people.avery, again.importId);
      expect(done.statusCode).toBe(200);
      const made = await rowsOf(again.importId);
      expect(done.json()).toEqual({
        importId: again.importId,
        rowIds: expect.arrayContaining(made.map((r) => r.id)),
      });
      expect(made.every((r) => r.deleted)).toBe(true);
      expect((await rowsOf(importId)).every((r) => !r.deleted)).toBe(true);
      await app.events.settled();
      expect(events.slice(before)).toContainEqual({
        name: 'databases.row.trashed',
        payload: expect.objectContaining({ databaseId: visitsId, actorId: people.avery.id }),
      });
      const summary = await get(
        people.avery,
        `/api/databases/${visitsId}/imports/${again.importId}`,
      );
      expect(summary.json()).toMatchObject({ status: 'undone', undoneAt: expect.any(String) });

      const twice = await undo(people.avery, again.importId);
      expect(twice.statusCode).toBe(409);
      expect(twice.json().error).toEqual({ code: 'conflict', message: IMPORT_MESSAGES.undone });

      // Seven days, then no more Undo.
      const old = await imported(csv(two));
      await db.execute(sql`UPDATE db_imports SET finished_at = now() - interval '8 days'
      WHERE id = ${old.importId}`);
      const late = await undo(people.avery, old.importId);
      expect(late.statusCode).toBe(400);
      expect(late.json().error).toEqual({ code: 'invalid', message: IMPORT_MESSAGES.tooLate });

      // Not finished, or failed.
      const { rows } = await db.execute<{ id: string; status: string }>(sql`
      INSERT INTO db_imports (database_id, "by", status)
      VALUES (${visitsId}, ${people.avery.id}, 'queued'), (${visitsId}, ${people.avery.id}, 'failed')
      RETURNING id, status`);
      const queued = await undo(people.avery, rows.find((r) => r.status === 'queued')!.id);
      expect(queued.statusCode).toBe(409);
      expect(queued.json().error).toEqual({
        code: 'conflict',
        message: IMPORT_MESSAGES.notFinished,
      });
      const failed = await undo(people.avery, rows.find((r) => r.status === 'failed')!.id);
      expect(failed.statusCode).toBe(400);
      expect(failed.json().error).toEqual({ code: 'invalid', message: IMPORT_MESSAGES.failed });
      expect((await undo(people.avery, 'not-an-id')).statusCode).toBe(404);
    },
    SLOW,
  );

  it(
    'keeps every message word for word',
    async () => {
      expect(IMPORT_MESSAGES).toEqual({
        unreadable: "This file couldn't be read.",
        fileType: 'Choose a .csv, .tsv or .xlsx file.',
        noSheet: 'This file has no sheet with that name.',
        plan: "The columns don't fit this database anymore. Check them and try again.",
        notFinished: "This import hasn't finished yet.",
        failed: 'This import failed, so there is nothing to undo.',
        undone: 'This import was already undone.',
        tooLate: "This import can't be undone anymore.",
        changedSince:
          'Some rows from this import changed since it ran, so nothing was moved to Trash.',
        gone: 'This database was deleted or moved to Trash.',
      });
      // The worker file is the server build's second entry; a missing one can't read anything.
      const restore = setImportReader({ url: pathToFileURL(join(workerDir, 'missing.mjs')) });
      try {
        const res = await preview(people.avery, csv(VISITS_CSV));
        expect(res.json().error).toEqual({ code: 'invalid', message: IMPORT_MESSAGES.unreadable });
      } finally {
        restore();
      }
    },
    SLOW,
  );
});
