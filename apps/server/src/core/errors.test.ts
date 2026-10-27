import Fastify from 'fastify';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorHandler, httpError } from './errors';

const app = Fastify({ bodyLimit: 64 });

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

  it('hides the details of unexpected errors', async () => {
    const response = await app.inject({ method: 'GET', url: '/broken' });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('server_error');
    expect(response.body).not.toContain('10.0.0.5');
  });
});
