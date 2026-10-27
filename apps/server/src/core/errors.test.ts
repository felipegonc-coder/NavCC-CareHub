import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase } from '../testing';
import { errorHandler, httpError, loggableError } from './errors';

const logs: string[] = [];
const app = Fastify({
  bodyLimit: 64,
  logger: { level: 'error', stream: { write: (line: string) => void logs.push(line) } },
});

/** Shaped like Drizzle's DrizzleQueryError around a PostgreSQL error: both repeat the value sent. */
function failedQuery(value: string) {
  const cause = Object.assign(new Error(`invalid input syntax for type uuid: "${value}"`), {
    code: '22P02',
    severity: 'ERROR',
    detail: `Value: ${value}`,
    routine: 'string_to_uuid',
  });
  return Object.assign(new Error(`Failed query: select $1::uuid\nparams: ${value}`, { cause }), {
    name: 'DrizzleQueryError',
    query: 'select $1::uuid',
    params: [value],
  });
}

beforeAll(async () => {
  app.setErrorHandler(errorHandler);
  app.get('/missing', async () => {
    throw httpError(404, 'not_found');
  });
  app.get('/clash', async () => {
    throw httpError(409, 'conflict', 'Someone renamed this page. Reload to see the new name.');
  });
  app.post('/parse', async (request) =>
    z
      .object({ email: z.email('Enter a valid email address.'), age: z.number() })
      .parse(request.body),
  );
  app.get('/broken', async () => {
    throw new Error('connection to 10.0.0.5 refused');
  });
  app.get('/failed-query', async () => {
    throw failedQuery('riley.chen@example.test');
  });
  await app.ready();
});

afterAll(() => app.close());

describe('errors', () => {
  it('sends httpError with the default message for its code', async () => {
    const response = await app.inject({ method: 'GET', url: '/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
    });
  });

  it('sends a specific message when given', async () => {
    const response = await app.inject({ method: 'GET', url: '/clash' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: 'conflict',
      message: 'Someone renamed this page. Reload to see the new name.',
    });
  });

  it('turns zod errors into 400 invalid with the issues, never the values sent', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/parse',
      payload: { email: 'not-an-address', age: 'x' },
    });
    expect(response.statusCode).toBe(400);
    const { error } = response.json();
    expect(error.code).toBe('invalid');
    expect(error.message).toBe('Enter a valid email address.');
    expect(error.details).toEqual([
      expect.objectContaining({ path: ['email'], message: 'Enter a valid email address.' }),
      expect.objectContaining({ path: ['age'] }),
    ]);
    expect(response.body).not.toContain('not-an-address');
  });

  it('gives Fastify client errors the code for their status', async () => {
    const badJson = await app.inject({
      method: 'POST',
      url: '/parse',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json().error.code).toBe('invalid');
    const tooBig = await app.inject({
      method: 'POST',
      url: '/parse',
      payload: { email: 'x'.repeat(100) },
    });
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.json().error.code).toBe('too_large');
  });

  it('hides the details of unexpected errors, and logs them', async () => {
    const response = await app.inject({ method: 'GET', url: '/broken' });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('server_error');
    expect(response.body).not.toContain('10.0.0.5');
    expect(logs.join('\n')).toContain('connection to 10.0.0.5 refused');
  });

  it('logs failed queries without the values in them', async () => {
    const response = await app.inject({ method: 'GET', url: '/failed-query' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('riley.chen');
    const logged = logs.join('\n');
    expect(logged).toContain('select $1::uuid');
    expect(logged).toContain('22P02');
    expect(logged).not.toContain('riley.chen');
  });

  it('loggableError keeps the type, SQL, database code, stack frames and causes', () => {
    const logged = loggableError(failedQuery('secret'));
    expect(logged).toMatchObject({
      type: 'DrizzleQueryError',
      query: 'select $1::uuid',
      cause: { type: 'Error', code: '22P02', severity: 'ERROR', routine: 'string_to_uuid' },
    });
    expect(logged.stack).toMatch(/^\s+at /);
    expect(JSON.stringify(logged)).not.toContain('secret');
    expect(loggableError(new TypeError('x is undefined'))).toMatchObject({
      type: 'TypeError',
      message: 'x is undefined',
    });
    expect(loggableError('a thrown string')).toEqual({ type: 'string' });
  });
});

describe.skipIf(!hasDatabase)('errors from PostgreSQL', () => {
  it('are logged without the values sent with the query', async () => {
    const marker = `marker-${randomBytes(6).toString('hex')}`;
    const lines: string[] = [];
    const testApp = await createTestApp({
      logger: { level: 'error', stream: { write: (line: string) => void lines.push(line) } },
      routes: (instance) => {
        instance.get('/api/test/failed-query', { config: { public: true } }, async () => {
          await instance.db.execute(sql`SELECT ${marker}::uuid AS id`);
          return { ok: true };
        });
      },
    });
    try {
      const response = await testApp.app.inject({ method: 'GET', url: '/api/test/failed-query' });
      expect(response.statusCode).toBe(500);
      const logged = lines.join('\n');
      expect(logged).toContain('::uuid');
      expect(logged).toContain('22P02');
      expect(logged).not.toContain(marker);
    } finally {
      await testApp.close();
    }
  });
});
