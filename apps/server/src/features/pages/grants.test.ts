// Access rules on a real database (decision 0012): space members, grants, inheritance, role limits,
// guests and database levels. Fictional people only.
import type { AccessLevel, BuiltInRoleKey } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import {
  getAccessForPages,
  getGrantLevel,
  getPageAccess,
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

const person = (role: BuiltInRoleKey, name: string) => createUser(db, { role, name });

let made = 0;
async function space(kind = 'open', ownerId: string | null = null) {
  made += 1;
  const { rows } = await db.execute<{ id: string }>(sql`
    INSERT INTO spaces (workspace_id, kind, owner_id, name)
    VALUES (${workspaceId}, ${kind}, ${ownerId}, ${`Space ${made}`}) RETURNING id`);
  return rows[0]!.id;
}

async function join(spaceId: string, who: TestUser, role: 'owner' | 'member' = 'member') {
  await db.execute(sql`INSERT INTO space_members (space_id, principal_type, principal_id, role)
    VALUES (${spaceId}, 'user', ${who.id}, ${role})`);
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
const user = (who: TestUser): Principal => ({ type: 'user', id: who.id });
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

async function levels(who: TestUser, ids: string[]): Promise<AccessLevel[]> {
  const found = await getAccessForPages(db, who.id, ids);
  return ids.map((id) => found.get(id) ?? 'none');
}

describe.skipIf(!hasDatabase)('page access', () => {
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
    people.admin = await person('admin', 'Avery Admin');
    workspaceId = people.admin.workspaceId!;
    people.editor = await person('editor', 'Eli Editor');
    people.editor2 = await person('editor', 'Emery Editor');
    people.commenter = await person('commenter', 'Casey Commenter');
    people.viewer = await person('viewer', 'Val Viewer');
  });
  afterAll(() => close());

  it('gives space members its default access and owners Full access, within their role', async () => {
    const s = await space('open');
    const top = await page(s);
    const child = await page(s, top);
    for (const who of [people.editor, people.commenter, people.viewer]) await join(s, who);
    await join(s, people.editor2, 'owner');
    expect(await levels(people.editor, [top, child])).toEqual(['edit', 'edit']);
    expect(await levels(people.commenter, [child])).toEqual(['comment']);
    expect(await levels(people.viewer, [child])).toEqual(['view']);
    expect(await levels(people.editor2, [child])).toEqual(['full']);
    // Admins have Full access in every team space; people outside it have nothing.
    expect(await levels(people.admin, [child])).toEqual(['full']);
    expect(await levels(await person('editor', 'Owen Outsider'), [top])).toEqual(['none']);
    await db.execute(sql`UPDATE spaces SET default_access = 'comment' WHERE id = ${s}`);
    expect(await levels(people.editor, [child])).toEqual(['comment']);
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
    const p = await page(await space('closed'));
    await grant({ pageId: p }, { type: 'role', id: people.commenter.roleId! }, 'comment');
    const later = await person('commenter', 'Lee Later');
    expect(await levels(later, [p])).toEqual(['comment']);
    expect(await levels(people.viewer, [p])).toEqual(['none']);
  });

  it('keeps a Private section to its owner, admins included, unless a page is shared', async () => {
    const mine = await page(await space('personal', people.editor.id));
    expect(await levels(people.editor, [mine])).toEqual(['full']);
    expect(await levels(people.admin, [mine])).toEqual(['none']);
    const viewersOwn = await page(await space('personal', people.viewer.id));
    expect(await levels(people.viewer, [viewersOwn])).toEqual(['view']);
    await grantAccess(db, {
      pageId: mine,
      principal: user(people.editor2),
      level: 'edit',
      grantedBy: people.editor.id,
    });
    expect(await levels(people.editor2, [mine])).toEqual(['edit']);
  });

  it('makes pages in an archived space read-only (SB-09)', async () => {
    const s = await space('private');
    const p = await page(s);
    await join(s, people.editor, 'owner');
    await db.execute(sql`UPDATE spaces SET archived_at = now() WHERE id = ${s}`);
    expect(await levels(people.editor, [p])).toEqual(['view']);
    expect(await levels(people.admin, [p])).toEqual(['view']);
  });

  it('gives database levels to rows: edit_content as edit, rows_only through the row resolver', async () => {
    const s = await space();
    const tracker = await page(s, null, { kind: 'database' });
    const row = await page(s, tracker, { kind: 'row' });
    const by = people.admin.id;
    const to = user(people.editor2);
    await grantAccess(db, { pageId: tracker, principal: to, level: 'edit_content', grantedBy: by });
    expect(await levels(people.editor2, [tracker, row])).toEqual(['edit_content', 'edit']);

    const reviews = await page(s, null, { kind: 'database' });
    const theirs = await page(s, reviews, { kind: 'row' });
    const others = await page(s, reviews, { kind: 'row' });
    const casey = user(people.commenter);
    await grantAccess(db, { pageId: reviews, principal: casey, level: 'rows_only', grantedBy: by });
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
    await grant({ pageId: theirs }, casey, 'view');
    expect(await levels(people.commenter, [theirs])).toEqual(['comment']);

    const plain = await page(s);
    await expect(
      grantAccess(db, { pageId: plain, principal: everyone, level: 'edit_content', grantedBy: by }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("tells Only rows they're in apart from Can view (getGrantLevel)", async () => {
    const s = await space();
    const visits = await page(s, null, { kind: 'database' });
    const row = await page(s, visits, { kind: 'row' });
    const val = people.viewer;
    await grantAccess(db, {
      pageId: visits,
      principal: user(val),
      level: 'rows_only',
      grantedBy: people.admin.id,
    });
    expect(await getGrantLevel(db, val.id, visits)).toBe('rows_only');
    expect(await getPageAccess(db, val.id, visits)).toBe('view');
    expect(await getGrantLevel(db, val.id, row)).toBe('none');

    // A real Can view (here the space's Can edit within the Viewer role) is plain view.
    await join(s, val);
    expect(await getGrantLevel(db, val.id, visits)).toBe('view');
    await join(s, people.editor);
    expect(await getGrantLevel(db, people.editor.id, visits)).toBe('edit');
    expect(await getGrantLevel(db, people.admin.id, visits)).toBe('full');
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(await getGrantLevel(db, val.id, missing)).toBe('none');
  });

  it('reaches guests only through grants to them, without the role limit, up to Can edit', async () => {
    const guest = await createUser(db, { kind: 'guest', name: 'Gray Guest' });
    const s = await space();
    const p = await page(s);
    await grant({ spaceId: s }, everyone, 'edit');
    await join(s, guest);
    expect(await levels(guest, [p])).toEqual(['none']);
    const by = people.admin.id;
    await grantAccess(db, { pageId: p, principal: user(guest), level: 'edit', grantedBy: by });
    expect(await levels(guest, [p])).toEqual(['edit']);
    await expect(
      grantAccess(db, { pageId: p, principal: user(guest), level: 'full', grantedBy: by }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('answers every ID asked, with none for missing, malformed and trashed pages', async () => {
    const s = await space();
    await join(s, people.editor);
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

  it('closes everything to people removed from the workspace, and spaces in Trash', async () => {
    const s = await space();
    const p = await page(s);
    const leaver = await person('editor', 'Lane Leaver');
    await join(s, leaver);
    await join(s, people.editor);
    expect(await levels(leaver, [p])).toEqual(['edit']);
    await db.execute(
      sql`UPDATE workspace_members SET removed_at = now() WHERE user_id = ${leaver.id}`,
    );
    expect(await levels(leaver, [p])).toEqual(['none']);
    await db.execute(sql`UPDATE spaces SET deleted_at = now() WHERE id = ${s}`);
    expect(await levels(people.editor, [p])).toEqual(['none']);
  });

  it('needs Full access to change grants and records every change (RP-04, RP-15)', async () => {
    const s = await space();
    const p = await page(s);
    await join(s, people.editor);
    const to = user(people.viewer);
    const admin = people.admin.id;
    await expect(
      grantAccess(db, { pageId: p, principal: to, level: 'view', grantedBy: people.editor.id }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const first = await grantAccess(db, {
      pageId: p,
      principal: to,
      level: 'comment',
      grantedBy: admin,
    });
    const second = await grantAccess(db, {
      pageId: p,
      principal: to,
      level: 'view',
      grantedBy: admin,
    });
    expect(second?.id).toBe(first?.id);
    await revokeAccess(db, first!.id, admin);
    const { rows } = await db.execute<{ before: string | null; after: string | null }>(sql`
      SELECT before_level AS before, after_level AS after FROM access_history
      WHERE page_id = ${p} ORDER BY created_at, id`);
    expect(rows.map((row) => [row.before, row.after])).toEqual([
      [null, 'comment'],
      ['comment', 'view'],
      ['view', null],
    ]);
    await expect(
      grantAccess(db, { spaceId: s, principal: everyone, level: 'view', grantedBy: admin }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('requirePageAccess answers 404 for missing or trashed pages and 403 below the level', async () => {
    const s = await space();
    await grant({ spaceId: s }, everyone, 'comment');
    const p = await page(s);
    const trashed = await page(s);
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${trashed}`);
    const ask = (who: TestUser, id: string) =>
      injectAs(app, who, { method: 'GET', url: `/api/test-pages/${id}` });
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
