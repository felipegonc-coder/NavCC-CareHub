import { randomUUID } from 'node:crypto';
import type { SearchResponse } from '@carehub/extras/search';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { reindexForSearch } from './index';
import { searchPages } from './pages';

describe.skipIf(!hasDatabase)('search on the page model (decision 0007)', () => {
  let test: TestApp;
  let editor: TestUser;
  let guest: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  const ids: Record<string, string> = {};

  async function space(name: string, kind: 'open' | 'private'): Promise<string> {
    const { rows } = await test.db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name) VALUES (${workspaceId}, ${kind}, ${name})
      RETURNING id`);
    return rows[0]!.id;
  }
  async function page(
    key: string,
    spaceId: string,
    parent: string | null,
    more: { archived?: boolean; trashed?: boolean } = {},
  ): Promise<string> {
    const { rows } = await test.db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, parent_id, title, position, created_by,
        updated_by, archived_at, deleted_at)
      VALUES (${workspaceId}, ${spaceId}, ${parent === null ? null : ids[parent]!}, ${key}, 'a0',
        ${editor.id}, ${editor.id}, ${more.archived ? sql`now()` : null},
        ${more.trashed ? sql`now()` : null})
      RETURNING id`);
    ids[key] = rows[0]!.id;
    return rows[0]!.id;
  }
  async function found(user: TestUser, text: string, includeArchived = false) {
    const response = await injectAs(test.app, user, {
      method: 'POST',
      url: '/api/search/query',
      payload: { text, ...(includeArchived ? { filters: { includeArchived } } : {}) },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response
      .json<SearchResponse>()
      .results.map((result) => result.title)
      .sort();
  }

  beforeAll(async () => {
    test = await createTestApp();
    editor = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    guest = await createUser(test.db, {
      kind: 'guest',
      name: 'Riley Chen',
      email: 'riley.chen@example.test',
    });
    outsider = await createUser(test.db, {
      role: null,
      name: 'Val Moreno',
      email: 'val.moreno@example.test',
    });
    workspaceId = editor.workspaceId!;
    const support = await space('Support', 'open');
    await test.db.execute(sql`
      INSERT INTO space_members (space_id, principal_type, principal_id)
      VALUES (${support}, 'user', ${editor.id})`);
    await page('Refund policy', support, null);
    await page('Refund steps', support, 'Refund policy');
    await page('Refund archive', support, 'Refund policy', { archived: true });
    await page('Refund archive notes', support, 'Refund archive');
    await page('Refund trash', support, 'Refund policy', { trashed: true });
    await page('Refund trash notes', support, 'Refund trash');
    await page('Refund ledger', await space('Finance', 'private'), null);
    await reindexForSearch(test.db, Object.values(ids));
  });
  afterAll(async () => {
    await test?.close();
  });

  it('reads pages with their parent pages, Archive and Trash', async () => {
    const missing = randomUUID();
    const pages = await searchPages().getPagesForIndex(test.db, [
      ids['Refund steps']!,
      ids['Refund archive notes']!,
      ids['Refund trash notes']!,
      missing,
      'not-an-id',
    ]);
    expect([...pages.keys()].sort()).toEqual(
      [ids['Refund steps'], ids['Refund archive notes'], ids['Refund trash notes']].sort(),
    );
    expect(pages.get(ids['Refund steps']!)).toMatchObject({
      workspaceId,
      parentId: ids['Refund policy'],
      ancestorIds: [ids['Refund policy']],
      kind: 'page',
      title: 'Refund steps',
      createdBy: editor.id,
      archivedAt: null,
      trashed: false,
    });
    const archived = pages.get(ids['Refund archive notes']!);
    expect(archived?.ancestorIds).toEqual([ids['Refund policy'], ids['Refund archive']]);
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect(pages.get(ids['Refund trash notes']!)).toMatchObject({ trashed: true });
  });

  it('lists page IDs in order, a few at a time', async () => {
    const all = Object.values(ids).sort();
    const list = (afterId: string | null, limit: number) =>
      searchPages().listPageIds(test.db, { afterId, limit });
    expect(await list(null, 100)).toEqual(all);
    expect(await list(all[1]!, 2)).toEqual(all.slice(2, 4));
    expect(await list(all[all.length - 1]!, 2)).toEqual([]);
  });

  it('finds what members can open, with their access from features/pages', async () => {
    expect(await found(editor, 'refund')).toEqual(['Refund policy', 'Refund steps']);
    expect(await found(editor, 'refund', true)).toEqual([
      'Refund archive',
      'Refund archive notes',
      'Refund policy',
      'Refund steps',
    ]);
  });

  it('lets guests find only what is shared with them, and nobody outside the workspace', async () => {
    expect(await found(guest, 'refund')).toEqual([]);
    await test.db.execute(sql`
      INSERT INTO access_grants (workspace_id, page_id, principal_type, principal_id, level)
      VALUES (${workspaceId}, ${ids['Refund steps']!}, 'user', ${guest.id}, 'view')`);
    expect(await found(guest, 'refund')).toEqual(['Refund steps']);

    const response = await injectAs(test.app, outsider, {
      method: 'POST',
      url: '/api/search/query',
      payload: { text: 'refund' },
    });
    expect(response.statusCode).toBe(403);
  });
});
