// Test harness for the spaces and pages routes: the features on the test database, with
// sign-in replaced by an `x-test-user` header so these tests only exercise our own rules.
// Fictional people and workspaces only.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import workspacesRoutes from '../workspaces/routes';
import { first, forbidden, HttpError } from './common';

export type Role = 'admin' | 'editor' | 'commenter' | 'viewer';
export type Person = { id: string; name: string; workspaceId: string; role: Role };
// Response bodies are checked field by field in the tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;
export type Reply = { status: number; body: Body };
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Tests that need Postgres run only when DATABASE_URL points at a migrated test database. */
export const databaseUrl = process.env.DATABASE_URL;

export type Harness = Awaited<ReturnType<typeof startHarness>>;

export async function startHarness() {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const db = drizzle(databaseUrl);
  const people = new Map<string, Person>();

  const app: FastifyInstance = Fastify();
  const requireUser = async (request: FastifyRequest) => {
    const person = people.get(String(request.headers['x-test-user']));
    if (!person) throw new HttpError(401, 'Sign in to continue.');
    request.user = { ...person, email: `${person.id}@example.test` };
  };
  app.decorate('db', db);
  app.decorateRequest('user', null);
  app.decorate('requireUser', requireUser);
  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    await requireUser(request);
    if (request.user?.role !== 'admin') throw forbidden();
  });
  await app.register(workspacesRoutes, { prefix: '/api' });
  await app.ready();

  let made = 0;
  return {
    app,
    db,
    async workspace(): Promise<string> {
      made += 1;
      const { rows } = await db.execute<{ id: string }>(
        sql`INSERT INTO workspaces (name) VALUES (${`Sunnyvale Clinic ${made}`}) RETURNING id`,
      );
      return first(rows).id;
    },
    async person(workspaceId: string, role: Role, name = `${role} ${made}`): Promise<Person> {
      const { rows } = await db.execute<{ id: string }>(sql`
        INSERT INTO users (email, name) VALUES (${`${randomUUID()}@example.test`}, ${name})
        RETURNING id`);
      const { id } = first(rows);
      await db.execute(sql`
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES (${workspaceId}, ${id}, ${role})`);
      const person = { id, name, workspaceId, role };
      people.set(id, person);
      return person;
    },
    async send(
      person: Person | null,
      method: Method,
      url: string,
      payload?: object,
    ): Promise<Reply> {
      const response = await app.inject({
        method,
        url,
        payload,
        headers: person ? { 'x-test-user': person.id } : {},
      });
      return { status: response.statusCode, body: response.body ? response.json() : undefined };
    },
    async close() {
      await app.close();
      await db.$client.end();
    },
  };
}
