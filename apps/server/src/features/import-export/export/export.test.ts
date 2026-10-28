import { randomUUID } from 'node:crypto';
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
} from '../../../testing';
import { drainJobsForTest } from '../../jobs/testing';
import { bindMemoryNotices, type MemoryNoticeStore } from '../../notices/testing';
import { ieExports } from './schema';
import { expireExports, MAX_EXPORT_BYTES, TOO_LARGE_MESSAGE, type ExportView } from './service';
import {
  bindExportSources,
  type ExportFile,
  type ExportPageInfo,
  type SecurityEvent,
} from './sources';
import { readZip } from './testing';

const workspaceId = randomUUID();
const FORBIDDEN = { error: { code: 'forbidden', message: "You don't have access to this." } };

// The stand-in world: pages with each person's level, their content, files, the workspace's
// "members can export" switch, its Admins, and the Security log.
const pages = new Map<string, ExportPageInfo>();
const levels = new Map<string, Map<string, AccessLevel>>();
const contents = new Map<string, unknown>();
const files = new Map<string, ExportFile>();
const admins = new Set<string>();
const securityLog: SecurityEvent[] = [];
let membersCanExport: boolean | undefined;

const doc = (...content: object[]) => ({ type: 'doc', content });
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('export size', () => {
  it('caps an export at 200 MB while the zip is kept in memory and in one row', () => {
    expect(MAX_EXPORT_BYTES).toBe(200 * 1024 * 1024);
    expect(TOO_LARGE_MESSAGE).toBe(
      'Exports can be up to 200 MB. Try fewer pages, or leave out files.',
    );
  });
});

describe.skipIf(!hasDatabase)('exports on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let riley: TestUser;
  let notices: MemoryNoticeStore;
  const unbind: (() => void)[] = [];

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    riley = await createUser(test.db, { name: 'Riley Chen', email: 'riley.chen@example.test' });
    admins.add(riley.id);
    const memory = bindMemoryNotices();
    notices = memory.store;
    unbind.push(memory.unbind);
    unbind.push(
      bindExportSources({
        pages: async (_db, ids) => {
          const found = new Map<string, ExportPageInfo>();
          for (const id of ids) {
            const page = pages.get(id);
            if (page) found.set(id, page);
          }
          return found;
        },
        subtree: async (_db, pageId) => {
          const under: ExportPageInfo[] = [];
          const visit = (parentId: string) => {
            for (const page of pages.values()) {
              if (page.parentId !== parentId) continue;
              under.push(page);
              visit(page.id);
            }
          };
          visit(pageId);
          return under;
        },
        access: async (_db, userId, ids) =>
          new Map(ids.map((id) => [id, levels.get(id)?.get(userId) ?? 'none'])),
        content: async (_db, pageId) => contents.get(pageId) ?? null,
        file: async (_db, { fileId }) => files.get(fileId) ?? null,
        membersCanExport: async () => membersCanExport,
        isAdmin: async (_db, _workspaceId, userId) => admins.has(userId),
        logSecurityEvent: async (_db, event) => {
          securityLog.push(event);
        },
      }),
    );
  });
  afterAll(async () => {
    for (const undo of unbind.reverse()) undo();
    await test?.close();
  });

  function addPage(title: string, parentId: string | null, access: [TestUser, AccessLevel][]) {
    const id = randomUUID();
    pages.set(id, { id, workspaceId, parentId, kind: 'page', title, icon: null });
    levels.set(id, new Map(access.map(([user, level]) => [user.id, level])));
    return id;
  }
  const call = (user: TestUser, method: 'GET' | 'POST', url: string, payload?: object) =>
    injectAs(test.app, user, { method, url, ...(payload ? { payload } : {}) });
  async function start(user: TestUser, body: object): Promise<ExportView> {
    const response = await call(user, 'POST', '/api/import-export/exports', body);
    expect(response.statusCode).toBe(201);
    return (response.json() as { export: ExportView }).export;
  }

  it('exports a page with its sub-pages at once, with relative links and pictures (IE-12, IE-17)', async () => {
    const pictureId = randomUUID();
    files.set(pictureId, {
      name: 'refund-form.png',
      mimeType: 'image/png',
      data: Buffer.from('a fictional picture'),
    });
    const guide = addPage('Support guide', null, [[avery, 'edit']]);
    const steps = addPage('Refund steps', guide, [[avery, 'edit']]);
    contents.set(
      guide,
      doc(paragraph('Start here.'), { type: 'subPage', attrs: { pageId: steps } }),
    );
    contents.set(
      steps,
      doc(paragraph('Fill in the form.'), {
        type: 'image',
        attrs: { fileId: pictureId, alt: 'Refund form' },
      }),
    );

    const view = await start(avery, { pageId: guide, includeSubpages: true });
    expect(view).toMatchObject({
      status: 'ready',
      format: 'markdown',
      pageCount: 2,
      skippedCount: 0,
      fileName: 'Support guide.zip',
    });
    expect(view.downloadUrl).toBe(`/api/import-export/exports/${view.id}/download`);

    const download = await call(avery, 'GET', view.downloadUrl ?? '');
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/zip');
    expect(download.headers['content-disposition']).toContain(
      "filename*=UTF-8''Support%20guide.zip",
    );
    expect(download.headers['cache-control']).toBe('private, no-store');
    const zip = readZip(download.rawPayload);
    expect([...zip.keys()].sort()).toEqual([
      'Support guide.md',
      'Support guide/Refund steps.md',
      'Support guide/Refund steps/refund-form.png',
    ]);
    expect(zip.get('Support guide.md')?.toString()).toContain(
      '(Support%20guide/Refund%20steps.md)',
    );
    expect(zip.get('Support guide/Refund steps.md')?.toString()).toContain(
      '![Refund form](Refund%20steps/refund-form.png)',
    );
    expect(zip.get('Support guide/Refund steps/refund-form.png')?.toString()).toBe(
      'a fictional picture',
    );

    // Who, what, format and size, recorded with the export (IE-17).
    expect(securityLog).toContainEqual({
      workspaceId,
      actorId: avery.id,
      action: 'export.created',
      targetId: guide,
      details: { exportId: view.id, format: 'markdown', pages: 2, sizeBytes: view.sizeBytes },
    });
    const [row] = await test.db
      .select({ downloads: ieExports.downloadCount })
      .from(ieExports)
      .where(eq(ieExports.id, view.id));
    expect(row?.downloads).toBe(1);
  });

  it('writes HTML without scripts (IE-13)', async () => {
    const page = addPage('Intake <script>', null, [[avery, 'view']]);
    contents.set(page, doc(paragraph('<script>alert(1)</script>')));
    const view = await start(avery, { pageId: page, format: 'html' });
    const zip = readZip((await call(avery, 'GET', view.downloadUrl ?? '')).rawPayload);
    const html = zip.get('Intake -script-.html')?.toString() ?? '';
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script/i);
  });

  it("leaves out sub-pages they can't open and counts them in a README (IE-14)", async () => {
    const team = addPage('Team notes', null, [
      [avery, 'edit'],
      [sam, 'view'],
    ]);
    addPage('Shift swaps', team, [
      [avery, 'edit'],
      [sam, 'view'],
    ]);
    addPage('Payroll notes', team, [[avery, 'edit']]);
    const view = await start(sam, { pageId: team, includeSubpages: true });
    expect(view).toMatchObject({ status: 'ready', pageCount: 2, skippedCount: 1 });
    const zip = readZip((await call(sam, 'GET', view.downloadUrl ?? '')).rawPayload);
    expect([...zip.keys()].sort()).toEqual([
      'README.md',
      'Team notes.md',
      'Team notes/Shift swaps.md',
    ]);
  });

  it('works only for its maker, and refuses pages they cannot view (IE-15)', async () => {
    const page = addPage('Visit checklist', null, [
      [avery, 'edit'],
      [sam, 'view'],
    ]);
    const view = await start(avery, { pageId: page });
    for (const url of [`/api/import-export/exports/${view.id}`, view.downloadUrl ?? '']) {
      const other = await call(sam, 'GET', url);
      expect(other.statusCode).toBe(403);
      expect(other.json()).toEqual(FORBIDDEN);
    }
    const hidden = addPage('Private notes', null, [[avery, 'edit']]);
    const refused = await call(sam, 'POST', '/api/import-export/exports', { pageId: hidden });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual(FORBIDDEN);
    const missing = await call(sam, 'POST', '/api/import-export/exports', {
      pageId: randomUUID(),
    });
    expect(missing.statusCode).toBe(404);
    const bad = await call(sam, 'POST', '/api/import-export/exports', {
      pageId: page,
      format: 'pdf',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('hides Export from members when an Admin turns it off, and Admins still export (IE-16)', async () => {
    const page = addPage('Care plan', null, [
      [sam, 'edit'],
      [riley, 'edit'],
    ]);
    const allowed = async (user: TestUser) =>
      (await call(user, 'GET', `/api/import-export/exports/allowed?pageId=${page}`)).json();
    expect(await allowed(sam)).toEqual({ allowed: true });
    membersCanExport = false;
    try {
      expect(await allowed(sam)).toEqual({ allowed: false });
      const refused = await call(sam, 'POST', '/api/import-export/exports', { pageId: page });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toEqual(FORBIDDEN);
      expect(await allowed(riley)).toEqual({ allowed: true });
      expect((await start(riley, { pageId: page })).status).toBe('ready');
    } finally {
      membersCanExport = undefined;
    }
  });

  it('runs big exports in the background and sends a 🔔 notice when ready (IE-15)', async () => {
    const handbook = addPage('Handbook', null, [[avery, 'edit']]);
    for (let n = 1; n <= 60; n += 1) addPage(`Chapter ${n}`, handbook, [[avery, 'view']]);
    const view = await start(avery, { pageId: handbook, includeSubpages: true });
    expect(view).toMatchObject({ status: 'running', progress: { done: 0, total: 61 } });
    expect(view.downloadUrl).toBeNull();

    await drainJobsForTest();
    const after = await call(avery, 'GET', `/api/import-export/exports/${view.id}`);
    const ready = (after.json() as { export: ExportView }).export;
    expect(ready).toMatchObject({ status: 'ready', pageCount: 61, progress: { done: 61 } });
    const zip = readZip((await call(avery, 'GET', ready.downloadUrl ?? '')).rawPayload);
    expect(zip.size).toBe(61);
    const notice = notices.records.find((record) => record.title === 'Your export is ready');
    expect(notice).toMatchObject({
      userId: avery.id,
      workspaceId,
      kind: 'alert',
      card: { type: 'page', pageId: handbook },
      buttons: [{ label: 'Download', href: `/exports/${view.id}` }],
    });
  });

  it('stops the link after 7 days and deletes the file (IE-15)', async () => {
    const page = addPage('Old intake form', null, [[avery, 'edit']]);
    const view = await start(avery, { pageId: page });
    const days = (view.expiresAt ? Date.parse(view.expiresAt) : 0) - Date.now();
    expect(Math.round(days / 86_400_000)).toBe(7);
    await test.db
      .update(ieExports)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(ieExports.id, view.id));
    const expired = await call(avery, 'GET', view.downloadUrl ?? '');
    expect(expired.statusCode).toBe(410);
    expect(await expireExports(test.db)).toBeGreaterThanOrEqual(1);
    const [row] = await test.db
      .select({ status: ieExports.status, file: ieExports.file })
      .from(ieExports)
      .where(eq(ieExports.id, view.id));
    expect(row).toEqual({ status: 'expired', file: null });
  });

  it('creates ie_exports exactly as the Drizzle definition describes it', async () => {
    const config = getTableConfig(ieExports);
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
    expect(inDatabase).toEqual(inDrizzle);
  });
});
