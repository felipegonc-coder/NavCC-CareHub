import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Browser, outcomeOf, problemOf, type Answer } from '../../../scripts/load/client.mjs';
import { startFakeCareHub, type FakeCareHub } from './fake-care-hub.js';

let fake: FakeCareHub | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

const status = (code: number) => ({ status: code, error: null }) as Answer;
// Made up for each run, so no password is written here.
const password = randomUUID();

describe('Browser', () => {
  it('keeps the cookies it gets and sends the CSRF header on writes', async () => {
    fake = await startFakeCareHub({ password });
    const browser = new Browser(fake.url);
    expect((await browser.send('GET', '/api/auth/me')).status).toBe(401);
    const signedOut = browser.csrf();
    expect(signedOut).toMatch(/^[0-9a-f-]{36}$/);
    const json = { email: 'eli.editor@example.test', password };
    const signIn = await browser.send('POST', '/api/auth/sign-in', { json });
    expect(signIn.status).toBe(200);
    expect(signIn.body).toEqual({ user: { email: 'eli.editor@example.test' } });
    expect(browser.csrf()).not.toBe(signedOut);
    expect((await browser.send('GET', '/api/auth/me')).status).toBe(200);
    expect((await browser.send('POST', '/api/auth/sign-out')).status).toBe(204);
    expect((await browser.send('GET', '/api/auth/me')).status).toBe(401);
  });

  it('is refused without the CSRF cookie', async () => {
    fake = await startFakeCareHub({ password });
    const json = { email: 'eli.editor@example.test', password };
    const answer = await new Browser(fake.url).send('POST', '/api/auth/sign-in', { json });
    expect(answer.status).toBe(403);
    expect(outcomeOf(answer)).toBe('failed');
  });

  it('gives status 0 and the reason when there is no answer', async () => {
    const silent = createServer(() => {});
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const { port } = silent.address() as AddressInfo;
    try {
      const slow = await new Browser(`http://127.0.0.1:${port}`, { timeoutMs: 100 }).send(
        'GET',
        '/api/health',
      );
      expect(slow).toMatchObject({ status: 0, error: 'no answer within 0.1 s' });
      expect(outcomeOf(slow)).toBe('error');
      expect(problemOf('GET /api/health', slow)).toBe('GET /api/health: no answer within 0.1 s');
    } finally {
      silent.closeAllConnections();
      await new Promise((resolve) => silent.close(resolve));
    }
    const refused = await new Browser(`http://127.0.0.1:${port}`).send('GET', '/api/health');
    expect(refused).toMatchObject({ status: 0, error: 'ECONNREFUSED' });
  });
});

describe('outcomeOf', () => {
  it('sorts answers into done, refused and server errors', () => {
    expect(outcomeOf(status(200))).toBe('ok');
    expect(outcomeOf(status(304))).toBe('ok');
    expect(outcomeOf(status(404))).toBe('failed');
    expect(outcomeOf(status(429))).toBe('failed');
    expect(outcomeOf(status(500))).toBe('error');
    expect(outcomeOf(status(0))).toBe('error');
    expect(problemOf('GET /api/pages/:id', status(503))).toBe('GET /api/pages/:id answered 503');
  });
});
