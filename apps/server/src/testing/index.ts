// Helpers for server tests in every lane (decision 0007, section 2.5). Fictional data only.
import { randomBytes } from 'node:crypto';
import { CSRF_COOKIE, CSRF_HEADER, type CurrentUser } from '@carehub/shared';
import type { FastifyInstance, FastifyServerOptions, InjectOptions } from 'fastify';
import pg from 'pg';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { Db, Tx } from '../db';
import { csrfTokenForSession } from '../features/auth/csrf';
import { users } from '../features/auth/schema';
import { SESSION_COOKIE, createSession, currentUserColumns } from '../features/auth/sessions';

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
  // `role` (admin, editor, commenter or viewer in the current workspace) comes with the roles PR.
  siteAdmin?: boolean;
  name?: string;
  email?: string;
  mustChangePassword?: boolean;
  locked?: boolean;
}

export type TestUser = CurrentUser;

/** A person (without a password: tests sign in with injectAs). */
export async function createUser(db: Db | Tx, options: CreateUserOptions = {}): Promise<TestUser> {
  const label = options.siteAdmin ? 'Site Admin' : 'Person';
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
    })
    .returning(currentUserColumns);
  if (!user) throw new Error('The test user was not saved.');
  return user;
}

/**
 * `app.inject` as this person: a new session (made directly, so sign-in limits don't apply), its cookies,
 * and the CSRF header.
 */
export async function injectAs(app: FastifyInstance, user: { id: string }, options: InjectOptions) {
  const { token } = await createSession(app.db, user.id, { userAgent: 'test' });
  const csrf = csrfTokenForSession(token);
  return app.inject({
    ...options,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`,
      [CSRF_HEADER]: csrf,
      ...options.headers,
    },
  });
}
