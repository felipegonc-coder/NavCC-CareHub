// The workspace the database route tests share (decision 0200): stand-ins for the roles pull
// request's tables (decision 0007 names) until it lands, an open space with a page, people by role,
// and rows. Fictional people only.
import { sql } from 'drizzle-orm';
import type { Db } from '../../db';
import { createTestApp, createUser, injectAs, type TestUser } from '../../testing';

export type Role = 'admin' | 'editor' | 'viewer';

const PERMISSIONS: Record<Role, string[]> = {
  admin: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share', 'workspace.admin'],
  editor: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share'],
  viewer: [],
};

/** The answer to a body the schemas refuse. */
export const INVALID = { error: { code: 'invalid', message: "That request isn't valid." } };

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface TestWorkspace {
  app: Awaited<ReturnType<typeof createTestApp>>['app'];
  db: Db;
  close: () => Promise<void>;
  workspaceId: string;
  spaceId: string;
  /** "Call-outs", a page in the space to put databases under. */
  pageId: string;
  /** A member with this role who can open the space. */
  person: (role: Role, name: string) => Promise<TestUser>;
  /** A request to the app as this person. */
  send: (
    who: TestUser,
    method: Method,
    url: string,
    payload?: object,
  ) => ReturnType<typeof injectAs>;
  /** A new row in the database with these values, a second newer than the one before. */
  addRow: (databaseId: string, title: string, values?: Record<string, unknown>) => Promise<string>;
}

export async function testWorkspace(): Promise<TestWorkspace> {
  const { app, db, close } = await createTestApp();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS roles (id uuid PRIMARY KEY DEFAULT
    gen_random_uuid(), workspace_id uuid NOT NULL, name text NOT NULL, permissions text[] NOT NULL)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS workspace_members (workspace_id uuid NOT NULL,
    user_id uuid NOT NULL, role_id uuid, kind text NOT NULL DEFAULT 'member',
    PRIMARY KEY (workspace_id, user_id))`);
  const workspace = await db.execute<{ id: string }>(
    sql`INSERT INTO workspaces (name) VALUES ('Blue Pine Plumbing') RETURNING id`,
  );
  const workspaceId = workspace.rows[0]!.id;
  const space = await db.execute<{ id: string }>(sql`
    INSERT INTO spaces (workspace_id, kind, name)
    VALUES (${workspaceId}, 'open', 'Operations') RETURNING id`);
  const spaceId = space.rows[0]!.id;
  const page = await db.execute<{ id: string }>(sql`
    INSERT INTO pages (workspace_id, space_id, kind, title, position)
    VALUES (${workspaceId}, ${spaceId}, 'page', 'Call-outs', 'a0') RETURNING id`);
  const pageId = page.rows[0]!.id;

  async function person(role: Role, name: string): Promise<TestUser> {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO roles (workspace_id, name, permissions)
      VALUES (${workspaceId}, ${`${role} for ${name}`}, ${`{${PERMISSIONS[role].join(',')}}`}::text[])
      RETURNING id`);
    const user = await createUser(db, { name });
    await db.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, role_id)
      VALUES (${workspaceId}, ${user.id}, ${rows[0]!.id})`);
    await db.execute(sql`INSERT INTO space_members (space_id, principal_type, principal_id)
      VALUES (${spaceId}, 'user', ${user.id})`);
    return user;
  }

  let rowCount = 0;
  async function addRow(databaseId: string, title: string, values: Record<string, unknown> = {}) {
    rowCount += 1;
    const created = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, parent_id, kind, title, position)
      VALUES (${workspaceId}, ${spaceId}, ${databaseId}, 'row', ${title},
        ${`r${String(rowCount).padStart(5, '0')}`})
      RETURNING id`);
    const id = created.rows[0]!.id;
    await db.execute(sql`
      INSERT INTO db_rows (page_id, database_id, workspace_id, "values", created_at, edited_at)
      VALUES (${id}, ${databaseId}, ${workspaceId}, ${JSON.stringify(values)}::jsonb,
        now() + ${rowCount}::int * interval '1 second', now())`);
    return id;
  }

  const send: TestWorkspace['send'] = (who, method, url, payload) =>
    injectAs(app, who, payload === undefined ? { method, url } : { method, url, payload });

  return { app, db, close, workspaceId, spaceId, pageId, person, send, addRow };
}
