import { randomUUID } from 'node:crypto';
import type { AccessLevel } from '@carehub/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../../testing';
import type { PrintView } from './print';
import { bindExportSources, type ExportPageInfo } from './sources';

const workspaceId = randomUUID();
const pages = new Map<string, ExportPageInfo>();
const levels = new Map<string, Map<string, AccessLevel>>();
const contents = new Map<string, unknown>();
let membersCanExport: boolean | undefined;
let visitsDatabase = '';

describe.skipIf(!hasDatabase)('the Print view on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let unbind: (() => void) | undefined;

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    unbind = bindExportSources({
      pages: async (_db, ids) => {
        const found = new Map<string, ExportPageInfo>();
        for (const id of ids) {
          const page = pages.get(id);
          if (page) found.set(id, page);
        }
        return found;
      },
      access: async (_db, userId, ids) =>
        new Map(ids.map((id) => [id, levels.get(id)?.get(userId) ?? 'none'])),
      content: async (_db, pageId) => contents.get(pageId) ?? null,
      rowProperties: async () => [{ name: 'Status', value: 'Open' }],
      csv: async (_db, { databaseId, viewId }) =>
        databaseId === visitsDatabase ? `Client,Visits\nRowan Diaz,${viewId ? 2 : 4}\n` : null,
      membersCanExport: async () => membersCanExport,
    });
  });
  afterAll(async () => {
    unbind?.();
    await test?.close();
  });

  function addPage(
    title: string,
    access: [TestUser, AccessLevel][],
    kind: 'page' | 'row' = 'page',
  ) {
    const id = randomUUID();
    pages.set(id, { id, workspaceId, parentId: null, kind, title, icon: null });
    levels.set(id, new Map(access.map(([user, level]) => [user.id, level])));
    return id;
  }
  const print = (user: TestUser, pageId: string) =>
    injectAs(test.app, user, { method: 'GET', url: `/api/import-export/print/${pageId}` });

  it('gives the content and the titles of linked pages they can open, only those', async () => {
    const steps = addPage('Refund steps', [[sam, 'view']]);
    const payroll = addPage('Payroll notes', [[avery, 'edit']]);
    const guide = addPage('Support guide', [[sam, 'view']]);
    contents.set(guide, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Start here.' }] },
        { type: 'subPage', attrs: { pageId: steps } },
        { type: 'subPage', attrs: { pageId: payroll } },
      ],
    });
    const response = await print(sam, guide);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const view = response.json() as PrintView;
    expect(view.page).toEqual({ id: guide, kind: 'page', title: 'Support guide', icon: null });
    expect(view.blocks).toHaveLength(3);
    expect(view.pages).toEqual({ [steps]: { title: 'Refund steps', icon: null }, [payroll]: null });
    expect(view.properties).toEqual([]);
    expect(view.databases).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('Payroll notes');
  });

  it('gives the inline databases they can open as their view, as CSV', async () => {
    visitsDatabase = addPage('Visits', [[sam, 'view']]);
    const hidden = addPage('Pay rates', [[avery, 'edit']]);
    const plan = addPage('Week plan', [[sam, 'view']]);
    const viewId = randomUUID();
    contents.set(plan, {
      type: 'doc',
      content: [
        { type: 'inlineDatabase', attrs: { databaseId: visitsDatabase } },
        { type: 'inlineDatabase', attrs: { databaseId: visitsDatabase, viewId } },
        { type: 'inlineDatabase', attrs: { databaseId: visitsDatabase } },
        { type: 'inlineDatabase', attrs: { databaseId: hidden } },
      ],
    });
    const view = (await print(sam, plan)).json() as PrintView;
    expect(view.databases).toEqual([
      { databaseId: visitsDatabase, viewId: null, csv: 'Client,Visits\nRowan Diaz,4\n' },
      { databaseId: visitsDatabase, viewId, csv: 'Client,Visits\nRowan Diaz,2\n' },
    ]);
    expect(view.pages[hidden]).toBeNull();
  });

  it('works when exports are turned off, and needs Can view (IE-16)', async () => {
    const row = addPage('Call Rowan', [[sam, 'view']], 'row');
    membersCanExport = false;
    try {
      const response = await print(sam, row);
      expect(response.statusCode).toBe(200);
      expect((response.json() as PrintView).properties).toEqual([
        { name: 'Status', value: 'Open' },
      ]);
    } finally {
      membersCanExport = undefined;
    }
    const hidden = addPage('Private notes', [[avery, 'edit']]);
    const refused = await print(sam, hidden);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({
      error: { code: 'forbidden', message: "You don't have access to this." },
    });
    expect((await print(sam, randomUUID())).statusCode).toBe(404);
    expect((await print(sam, 'not-a-page')).statusCode).toBe(400);
  });
});
