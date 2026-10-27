// Access rules on a real database (decision 0005): grants, inheritance, role limits, guests and
// database levels. Fictional people only.
import type { AccessLevel } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, injectAs, type TestUser } from '../../testing';
import {
  getAccessForPages,
  grantAccess,
  pageAccessOf,
  registerAccessResolver,
  revokeAccess,
  writeGrant,
  type Principal,
} from './access';

let close: () => Promise<void>;
let app: Awaited<ReturnType<typeof createTestApp>>['app'];
let db: Db;
let workspaceId: string;
const people = {} as Record<'admin' | 'editor' | 'editor2' | 'commenter' | 'viewer', TestUser>;

beforeAll(async () => {
  ({ app, db, close } = await createTestApp({
    routes: (server) => {
      // Another feature's route behind app.requirePageAccess.
      const check = { preHandler: server.requirePageAccess('comment') };
      server.get('/api/test-pages/:id', check, async (request) => ({
        level: pageAccessOf(request).level,
      }));
    },
  }));
  people.admin = await createUser(db, { role: 'admin', name: 'Avery Admin' });
  people.editor = await createUser(db, { role: 'editor', name: 'Eli Editor' });
  people.editor2 = await createUser(db, { role: 'editor', name: 'Emery Editor' });
  people.commenter = await createUser(db, { role: 'commenter', name: 'Casey Commenter' });
  people.viewer = await createUser(db, { role: 'viewer', name: 'Val Viewer' });
  workspaceId = await memberField(people.editor.id, sql`workspace_id`);
});
afterAll(() => close());

async function memberField(userId: string, column: ReturnType<typeof sql>): Promise<string> {
  const { rows } = await db.execute<{ value: string }>(
    sql`SELECT ${column} AS value FROM workspace_members WHERE user_id = ${userId}`,
  );
  return rows[0]!.value;
}

let made = 0;
async function space(kind: 'team' | 'private' = 'team', ownerId: string | null = null) {
  made += 1;
  const { rows } = await db.execute<{ id: string }>(sql`
    INSERT INTO spaces (workspace_id, kind, owner_id, name, position)
    VALUES (${workspaceId}, ${kind}, ${ownerId}, ${`Space ${made}`}, ${`V${made}`}) RETURNING id`);
  return rows[0]!.id;
}

async function page(
  spaceId: string,
  parentId: string | null = null,
  options: { kind?: 'page' | 'database' | 'row'; inherit?: boolean } = {},
) {
  made += 1;
  const { rows } = await db.execute<{ id: string }>(sql`
    INSERT INTO pages (workspace_id, space_id, parent_id, kind, inherit_access, title, position)
    VALUES (${workspaceId}, ${spaceId}, ${parentId}, ${options.kind ?? 'page'},
      ${options.inherit ?? true}, ${`Page ${made}`}, ${`V${made}`})
    RETURNING id`);
  return rows[0]!.id;
}

const everyone: Principal = { type: 'everyone' };
const user = (person: TestUser): Principal => ({ type: 'user', id: person.id });
const grant = (
  place: { spaceId?: string; pageId?: string },
  to: Principal,
  level: 'view' | 'comment' | 'edit' | 'full',
) =>
  writeGrant(
    db,
    { workspaceId, spaceId: place.spaceId ?? null, pageId: place.pageId ?? null },
    to,
    level,
    people.admin.id,
  );

async function levels(person: TestUser, ids: string[]): Promise<AccessLevel[]> {
  const found = await getAccessForPages(db, person.id, ids);
  return ids.map((id) => found.get(id) ?? 'none');
}

describe('page access', () => {
  it('passes an open space down to every page, limited by role (RP-03)', async () => {
    const s = await space();
    const top = await page(s);
    const child = await page(s, top);
    await grant({ spaceId: s }, everyone, 'edit');
    expect(await levels(people.editor, [top, child])).toEqual(['edit', 'edit']);
    expect(await levels(people.commenter, [child])).toEqual(['comment']);
    expect(await levels(people.viewer, [child])).toEqual(['view']);
    expect(await levels(people.admin, [child])).toEqual(['full']);
  });

  it('takes the highest grant, and Stop inheriting drops what comes from above (RP-08)', async () => {
    const s = await space();
    const top = await page(s);
    const closed = await page(s, top, { inherit: false });
    await grant({ spaceId: s }, everyone, 'view');
    await grant({ pageId: top }, user(people.editor), 'full');
    expect(await levels(people.editor, [top, closed])).toEqual(['full', 'none']);
    expect(await levels(people.editor2, [top, closed])).toEqual(['view', 'none']);
    await grant({ pageId: closed }, user(people.editor2), 'comment');
    expect(await levels(people.editor2, [closed])).toEqual(['comment']);
  });

  it('lets a role grant reach people who get the role later (RP-07)', async () => {
    const s = await space();
    const p = await page(s);
    const roleId = await memberField(people.commenter.id, sql`role_id`);
    await grant({ pageId: p }, { type: 'role', id: roleId }, 'comment');
    const later = await createUser(db, { role: 'commenter', name: 'Lee Later' });
    expect(await levels(later, [p])).toEqual(['comment']);
    expect(await levels(people.viewer, [p])).toEqual(['none']);
  });

  it('keeps private spaces to their owner, admins included (RP-14)', async () => {
    const mine = await page(await space('private', people.editor.id));
    expect(await levels(people.editor, [mine])).toEqual(['full']);
    expect(await levels(people.admin, [mine])).toEqual(['none']);
    const viewersOwn = await page(await space('private', people.viewer.id));
    expect(await levels(people.viewer, [viewersOwn])).toEqual(['view']);
    // A page in a private space can still be shared, e.g. meeting notes with attendees.
    await grantAccess(db, {
      pageId: mine,
      principal: user(people.editor2),
      level: 'edit',
      grantedBy: people.editor.id,
    });
    expect(await levels(people.editor2, [mine])).toEqual(['edit']);
  });

  it('gives database levels to rows: edit_content as edit, rows_only through the row resolver', async () => {
    const s = await space();
    const tracker = await page(s, null, { kind: 'database' });
    const row = await page(s, tracker, { kind: 'row' });
    await grantAccess(db, {
      pageId: tracker,
      principal: user(people.editor2),
      level: 'edit_content',
      grantedBy: people.admin.id,
    });
    expect(await levels(people.editor2, [tracker, row])).toEqual(['edit_content', 'edit']);

    const reviews = await page(s, null, { kind: 'database' });
    const theirs = await page(s, reviews, { kind: 'row' });
    const others = await page(s, reviews, { kind: 'row' });
    await grantAccess(db, {
      pageId: reviews,
      principal: user(people.commenter),
      level: 'rows_only',
      grantedBy: people.admin.id,
    });
    expect(await levels(people.commenter, [reviews, theirs, others])).toEqual([
      'view',
      'none',
      'none',
    ]);
    registerAccessResolver('row', async (ctx) =>
      ctx.databasePageId === reviews && ctx.rowPageId === theirs && ctx.grantLevel === 'rows_only'
        ? 'edit'
        : ctx.inherited,
    );
    // The resolver lifts the row to Can edit; the Commenter role keeps it at Can comment.
    expect(await levels(people.commenter, [theirs, others])).toEqual(['comment', 'none']);
    // A grant on the row itself doesn't hide the database's rows_only from the resolver.
    await grant({ pageId: theirs }, user(people.commenter), 'view');
    expect(await levels(people.commenter, [theirs])).toEqual(['comment']);

    const plain = await page(s);
    await expect(
      grantAccess(db, {
        pageId: plain,
        principal: everyone,
        level: 'edit_content',
        grantedBy: people.admin.id,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('reaches guests only through grants to them, never with Full access', async () => {
    const guest = await createUser(db, { role: 'viewer', name: 'Gray Guest' });
    await db.execute(
      sql`UPDATE workspace_members SET kind = 'guest', role_id = NULL WHERE user_id = ${guest.id}`,
    );
    const s = await space();
    const p = await page(s);
    await grant({ spaceId: s }, everyone, 'edit');
    expect(await levels(guest, [p])).toEqual(['none']);
    const by = people.admin.id;
    await grantAccess(db, { pageId: p, principal: user(guest), level: 'edit', grantedBy: by });
    expect(await levels(guest, [p])).toEqual(['edit']);
    await expect(
      grantAccess(db, { pageId: p, principal: user(guest), level: 'full', grantedBy: by }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      grantAccess(db, { spaceId: s, principal: user(guest), level: 'view', grantedBy: by }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('answers every ID asked, with none for missing, malformed and trashed pages', async () => {
    const s = await space();
    await grant({ spaceId: s }, everyone, 'edit');
    const live = await page(s);
    const trashed = await page(s);
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${trashed}`);
    const missing = '00000000-0000-4000-8000-00000000abcd';
    const found = await getAccessForPages(db, people.editor.id, [live, trashed, missing, 'nope']);
    expect([...found.entries()]).toEqual([
      [live, 'edit'],
      [trashed, 'none'],
      [missing, 'none'],
      ['nope', 'none'],
    ]);
  });

  it('needs Full access to change grants and records every change (RP-04, RP-15)', async () => {
    const s = await space();
    const p = await page(s);
    await grant({ spaceId: s }, everyone, 'edit');
    const to = user(people.viewer);
    await expect(
      grantAccess(db, { pageId: p, principal: to, level: 'view', grantedBy: people.editor.id }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const first = await grantAccess(db, {
      pageId: p,
      principal: to,
      level: 'comment',
      grantedBy: people.admin.id,
    });
    const second = await grantAccess(db, {
      pageId: p,
      principal: to,
      level: 'view',
      grantedBy: people.admin.id,
    });
    expect(second?.id).toBe(first?.id);
    await revokeAccess(db, first!.id, people.admin.id);
    const { rows } = await db.execute<{ before: string | null; after: string | null }>(sql`
      SELECT before_level AS before, after_level AS after FROM access_history
      WHERE page_id = ${p} ORDER BY created_at, id`);
    expect(rows.map((row) => [row.before, row.after])).toEqual([
      [null, 'comment'],
      ['comment', 'view'],
      ['view', null],
    ]);
    const priv = await space('private', people.editor.id);
    await expect(
      grantAccess(db, {
        spaceId: priv,
        principal: everyone,
        level: 'view',
        grantedBy: people.editor.id,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('requirePageAccess answers 404 for missing or trashed pages and 403 below the level', async () => {
    const s = await space();
    await grant({ spaceId: s }, everyone, 'comment');
    const p = await page(s);
    const trashed = await page(s);
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${trashed}`);
    const ask = (person: TestUser, id: string) =>
      injectAs(app, person, { method: 'GET', url: `/api/test-pages/${id}` });
    const ok = await ask(people.commenter, p);
    expect([ok.statusCode, ok.json()]).toEqual([200, { level: 'comment' }]);
    const closed = await ask(people.viewer, p);
    expect([closed.statusCode, closed.json()]).toEqual([
      403,
      { error: { code: 'forbidden', message: "You don't have access to this." } },
    ]);
    const gone = await ask(people.editor, trashed);
    expect([gone.statusCode, gone.json()]).toEqual([
      404,
      { error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' } },
    ]);
    expect((await ask(people.editor, 'not-an-id')).statusCode).toBe(404);
  });
});
