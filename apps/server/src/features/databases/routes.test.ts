// Database routes on a real database (decision 0200): create, read as each person may see it, and
// settings writes with the version check, Lock structure and access levels. Fictional people only.
import { defaultConfig, newProperty, type Property } from '@carehub/databases';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { grantAccess } from '../pages';
import { getDefaultWorkspace } from '../workspaces';
import { changeDatabase } from './store';

const INVALID = { error: { code: 'invalid', message: "That request isn't valid." } };

describe.skipIf(!hasDatabase)('database routes', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  let databaseId: string;
  const people = {} as Record<'admin' | 'avery' | 'jordan', TestUser>;

  /** A member with a built-in role who has joined the Operations space. */
  async function person(role: 'admin' | 'editor' | 'viewer', name: string): Promise<TestUser> {
    const user = await createUser(db, { role, name });
    await db.execute(sql`INSERT INTO space_members (space_id, principal_type, principal_id)
      VALUES (${spaceId}, 'user', ${user.id})`);
    return user;
  }

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    workspaceId = (await getDefaultWorkspace(db))!.id;
    const space = await db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name)
      VALUES (${workspaceId}, 'open', 'Operations') RETURNING id`);
    spaceId = space.rows[0]!.id;
    const page = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, kind, title, position)
      VALUES (${workspaceId}, ${spaceId}, 'page', 'Call-outs', 'a0') RETURNING id`);
    pageId = page.rows[0]!.id;
    people.admin = await person('admin', 'Morgan Reyes');
    people.avery = await person('editor', 'Avery Lin');
    people.jordan = await person('viewer', 'Jordan Park');
  });

  afterAll(async () => {
    await close?.();
  });

  const post = (who: TestUser, payload: unknown) =>
    injectAs(app, who, { method: 'POST', url: '/api/databases', payload: payload as object });
  const get = (who: TestUser, id = databaseId) =>
    injectAs(app, who, { method: 'GET', url: `/api/databases/${id}` });
  const patch = (who: TestUser, payload: unknown) =>
    injectAs(app, who, {
      method: 'PATCH',
      url: `/api/databases/${databaseId}`,
      payload: payload as object,
    });

  it('creates a database under a page, with a Name property and a Table view', async () => {
    const res = await post(people.avery, { parentId: pageId, inline: false, title: 'Jobs' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    databaseId = body.id;
    expect(body).toMatchObject({
      title: 'Jobs',
      inline: false,
      locked: false,
      viewerAccess: 'edit',
      version: 1,
      accessRules: [],
      templates: [],
      defaultTemplateId: null,
    });
    expect(body.properties).toHaveLength(1);
    expect(body.properties[0]).toMatchObject({ name: 'Name', config: { type: 'title' } });
    expect(body.views).toHaveLength(1);
    expect(body.views[0]).toMatchObject({ name: 'Table', layout: 'table' });
    const { rows } = await db.execute<{ kind: string; parent_id: string }>(
      sql`SELECT kind, parent_id FROM pages WHERE id = ${databaseId}`,
    );
    expect(rows[0]).toEqual({ kind: 'database', parent_id: pageId });

    const inline = await post(people.avery, { parentId: pageId, inline: true });
    expect(inline.statusCode).toBe(201);
    expect(inline.json()).toMatchObject({ inline: true, title: '' });
  });

  it('refuses bad bodies, database parents and people who can’t edit the page', async () => {
    const missing = await post(people.avery, { parentId: pageId });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual(INVALID);
    const extra = await post(people.avery, { parentId: pageId, inline: false, color: 'red' });
    expect(extra.statusCode).toBe(400);
    const underDatabase = await post(people.avery, { parentId: databaseId, inline: true });
    expect(underDatabase.statusCode).toBe(400);
    const viewer = await post(people.jordan, { parentId: pageId, inline: false });
    expect(viewer.statusCode).toBe(403);
  });

  it('answers GET /:id for each person, and 404 for anything that isn’t a database', async () => {
    const res = await get(people.jordan);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: databaseId, viewerAccess: 'view', version: 1 });
    expect((await get(people.jordan, pageId)).statusCode).toBe(404);
    expect((await get(people.jordan, '0b5f5a4e-1c1d-4e55-9a51-6f2f1d2b9c00')).statusCode).toBe(404);
    expect((await get(people.jordan, 'not-an-id')).statusCode).toBe(404);
  });

  it('answers rows_only to someone only an "Only rows they’re in" share lets in', async () => {
    const sam = await createUser(db, { name: 'Sam Ortiz' });
    expect((await get(sam)).statusCode).toBe(403);
    await grantAccess(db, {
      pageId: databaseId,
      principal: { type: 'user', id: sam.id },
      level: 'rows_only',
      grantedBy: people.admin.id,
    });
    const res = await get(sam);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: databaseId, viewerAccess: 'rows_only', version: 1 });
  });

  it('saves settings with the version, and refuses a stale one', async () => {
    const layout = { pinned: [], properties: 'panel', comments: 'compact', backlinks: 'count' };
    const res = await patch(people.avery, { version: 1, rowPageLayout: layout });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: 2, rowPageLayout: layout, viewerAccess: 'edit' });

    const stale = await patch(people.avery, { version: 1, description: [{ text: 'Call-outs' }] });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({
      error: { code: 'conflict', message: 'This database changed. Reload to see the latest.' },
    });
    expect((await patch(people.avery, { version: 2, rowPageLayout: 'panel' })).statusCode).toBe(
      400,
    );
    expect((await patch(people.jordan, { version: 2, locked: true })).statusCode).toBe(403);
  });

  it('lets only Full access lock the structure, and keeps it locked', async () => {
    expect((await patch(people.avery, { version: 2, locked: true })).statusCode).toBe(403);
    const locked = await patch(people.admin, { version: 2, locked: true });
    expect(locked.statusCode).toBe(200);
    expect(locked.json()).toMatchObject({ locked: true, version: 3, viewerAccess: 'full' });

    const blocked = await patch(people.avery, { version: 3, subItems: true });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('forbidden');
    const unlocked = await patch(people.admin, { version: 3, locked: false });
    expect(unlocked.json()).toMatchObject({ locked: false, version: 4 });
  });

  it('adds the sub-item and dependency relation pairs, and turns them off', async () => {
    const res = await patch(people.avery, {
      version: 4,
      subItems: true,
      dependencies: { shift: 'shift' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const byName = new Map<string, Property>(
      body.properties.map((p: Property) => [p.name, p] as const),
    );
    const parent = byName.get('Parent item');
    const children = byName.get('Sub-items');
    expect(parent?.config).toEqual({
      type: 'relation',
      targetDatabaseId: databaseId,
      single: true,
      twoWayPropertyId: children?.id,
    });
    expect(body.subItems).toEqual({
      parentPropertyId: parent?.id,
      childrenPropertyId: children?.id,
    });
    expect(body.dependencies).toEqual({
      blockedByPropertyId: byName.get('Blocked by')?.id,
      blockingPropertyId: byName.get('Blocking')?.id,
      shift: 'shift',
    });
    expect(body.views[0].properties).toContainEqual({ propertyId: parent?.id, visible: false });

    const off = await patch(people.avery, { version: 5, subItems: false, dependencies: null });
    expect(off.json()).toMatchObject({ version: 6, subItems: null, dependencies: null });
    expect(off.json().properties).toHaveLength(5);
  });

  it('leaves out properties a person can’t see, and the formulas that read them', async () => {
    const gate: Property = {
      ...newProperty('Gate code', defaultConfig('text')),
      access: { see: [{ type: 'user', id: people.avery.id }], change: null },
    };
    const copy = newProperty('Gate code again', {
      type: 'formula',
      expression: `prop("${gate.id}")`,
      resultKind: null,
      number: null,
    });
    const saved = await changeDatabase(db, databaseId, 6, (current) => ({
      properties: [...current.properties, gate, copy],
    }));
    expect(saved.version).toBe(7);

    const jordan = (await get(people.jordan)).json();
    const jordanIds = jordan.properties.map((p: Property) => p.id);
    expect(jordanIds).not.toContain(gate.id);
    expect(jordanIds).not.toContain(copy.id);
    const avery = (await get(people.avery)).json();
    expect(avery.properties.map((p: Property) => p.id)).toEqual(
      expect.arrayContaining([gate.id, copy.id]),
    );
    expect(avery.version).toBe(7);
  });
});
