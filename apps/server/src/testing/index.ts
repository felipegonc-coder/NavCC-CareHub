// Helpers for server tests in every feature (decision 0007, section 2.5). Fictional data only.
import { createHash, randomBytes } from 'node:crypto';
import {
  CSRF_HEADER,
  BUILT_IN_ROLES,
  type BuiltInRoleKey,
  type CurrentUser,
  type MembershipKind,
  type PermissionKey,
} from '@carehub/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyServerOptions, InjectOptions } from 'fastify';
import pg from 'pg';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { Db, Tx } from '../db';
import { csrfTokenForSession } from '../features/auth/csrf';
import { hashPassword } from '../features/auth/passwords';
import { users } from '../features/auth/schema';
import { createSession, currentUserColumns } from '../features/auth/sessions';
import { createRole } from '../features/roles';
import {
  addMember,
  getDefaultWorkspace,
  roles,
  syncDefaultWorkspace,
} from '../features/workspaces';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) {
  throw new Error('DATABASE_URL must be set in CI: the server tests need Postgres.');
}

/** Whether Postgres is available. Use `describe.skipIf(!hasDatabase)` for tests that need it. */
export const hasDatabase = Boolean(baseUrl);

/** A new, empty database on the DATABASE_URL server, and a function that drops it. */
export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  if (!baseUrl) throw new Error('DATABASE_URL is not set.');
  const name = `carehub_test_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const pool = new pg.Pool({ connectionString: baseUrl, max: 1 });
      try {
        await pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await pool.end();
      }
    },
  };
}

export interface TestAppOptions {
  /** Settings on top of the test defaults (DATABASE_URL always points at the new database). */
  env?: Record<string, string | undefined>;
  logger?: FastifyServerOptions['logger'];
  /** Extra routes for the test, added before the app starts. */
  routes?: (app: FastifyInstance) => void | Promise<void>;
}

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  /** Closes the app and drops its database. */
  close: () => Promise<void>;
}

/** The whole server on its own new database, with every migration applied. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const database = await createTestDatabase();
  let app: FastifyInstance | undefined;
  try {
    const config = loadConfig({
      NODE_ENV: 'test',
      COOKIE_SECURE: 'false',
      ...options.env,
      DATABASE_URL: database.url,
    });
    app = await buildApp({ config, logger: options.logger });
    await options.routes?.(app);
    await app.ready();
  } catch (error) {
    await app?.close();
    await database.drop();
    throw error;
  }
  const ready = app;
  return {
    app: ready,
    db: ready.db,
    close: async () => {
      await ready.close();
      await database.drop();
    },
  };
}

export interface CreateUserOptions {
  /** Built-in role in the current workspace (default `editor`); null for someone outside the workspace. */
  role?: BuiltInRoleKey | null;
  /** A one-off custom role with exactly these permissions (reused for the same set). */
  permissions?: readonly PermissionKey[];
  /** A role of the current workspace, for example one made with `createRole`. */
  roleId?: string;
  /** `guest`: no role, no permissions, only what's shared with them. Default `member`. */
  kind?: MembershipKind;
  siteAdmin?: boolean;
  name?: string;
  email?: string;
  mustChangePassword?: boolean;
  locked?: boolean;
  /** Lets the person sign in with this password (make it up in the test, never a fixed one). */
  password?: string;
}

export interface TestUser extends CurrentUser {
  /** The current workspace, or null when the person isn't in it. */
  workspaceId: string | null;
  /** The person's role there (null for guests and people outside the workspace). */
  roleId: string | null;
}

/** The custom role createUser uses for a set of permissions (one per set, so the 20-role limit holds). */
async function testRoleId(db: Db | Tx, permissions: readonly PermissionKey[]): Promise<string> {
  const keys = [...new Set(permissions)].sort();
  const name = `Test ${createHash('sha256').update(keys.join(' ')).digest('hex').slice(0, 12)}`;
  const workspace = (await getDefaultWorkspace(db)) ?? (await syncDefaultWorkspace(db));
  const [existing] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.workspaceId, workspace.id), eq(roles.name, name)));
  if (existing) return existing.id;
  return (await createRole(db, { workspaceId: workspace.id, name, permissions: keys })).id;
}

/**
 * A fictional person at example.test, without a password unless `password` is given (tests sign in
 * with injectAs). By default an Editor of the current workspace.
 */
export async function createUser(db: Db | Tx, options: CreateUserOptions = {}): Promise<TestUser> {
  const guest = options.kind === 'guest';
  const custom = options.roleId !== undefined || options.permissions !== undefined;
  const outside = options.role === null && !guest && !custom;
  const role = options.role ?? 'editor';
  const label = guest
    ? 'Guest'
    : options.siteAdmin
      ? 'Site Admin'
      : outside
        ? 'Person'
        : custom
          ? 'Member'
          : BUILT_IN_ROLES[role].name;
  const [user] = await db
    .insert(users)
    .values({
      email:
        options.email ??
        `${label.toLowerCase().replace(' ', '-')}-${randomBytes(6).toString('hex')}@example.test`,
      name: options.name ?? `Test ${label}`,
      isSiteAdmin: options.siteAdmin ?? false,
      mustChangePassword: options.mustChangePassword ?? false,
      lockedAt: options.locked ? new Date() : null,
      passwordHash: options.password === undefined ? null : await hashPassword(options.password),
    })
    .returning(currentUserColumns);
  if (!user) throw new Error('The test user was not saved.');
  let membership: { workspaceId: string; roleId: string | null } | null = null;
  if (guest) {
    membership = await addMember(db, { userId: user.id, kind: 'guest' });
  } else if (custom) {
    const roleId = options.roleId ?? (await testRoleId(db, options.permissions ?? []));
    membership = await addMember(db, { userId: user.id, roleId });
  } else if (!outside) {
    membership = await addMember(db, { userId: user.id, role });
  }
  return {
    ...user,
    workspaceId: membership?.workspaceId ?? null,
    roleId: membership?.roleId ?? null,
  };
}

/**
 * `app.inject` as this person: a new session (made directly, so sign-in limits don't apply), its cookies,
 * and the CSRF header.
 */
export async function injectAs(app: FastifyInstance, user: { id: string }, options: InjectOptions) {
  const { token } = await createSession(app.db, user.id, { userAgent: 'test' });
  const csrf = csrfTokenForSession(token);
  const names = app.sessionCookies.names;
  return app.inject({
    ...options,
    headers: {
      cookie: `${names.session}=${token}; ${names.csrf}=${csrf}`,
      [CSRF_HEADER]: csrf,
      ...options.headers,
    },
  });
}
