import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type TestApp,
  type TestUser,
  createTestApp,
  createUser,
  hasDatabase,
} from '../../../testing';
import { SESSION_COOKIE } from '../../auth';
import {
  OAUTH_STATE_TTL_MS,
  hashOAuthState,
  saveOAuthState,
  signInSessionKey,
  takeOAuthState,
} from './oauth-states';
import { calendarOAuthStates } from './schema';
import { TEST_SEALED_SECRET } from './testing';

const TOKEN = 'kQ4u8Tz1dGm3xV0bN7sLp2yR9aE6wC5hJ1fK8iO3uZq';
const asRequest = (fields: object) => fields as unknown as FastifyRequest;
const withCookie = (token: string) => asRequest({ cookies: { [SESSION_COOKIE]: token } });

describe('signInSessionKey', () => {
  it('names a session by a hash that never holds its token', () => {
    const key = signInSessionKey(withCookie(TOKEN));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain(TOKEN);
    expect(key).not.toBe(hashOAuthState(TOKEN));
    expect(signInSessionKey(withCookie(TOKEN))).toBe(key);
    expect(signInSessionKey(withCookie(`${TOKEN.slice(1)}x`))).not.toBe(key);
    expect(signInSessionKey(asRequest({ cookies: {} }))).toBeUndefined();
  });

  it("uses the request's session id once accounts add it", () => {
    const id = '7d3b1c2e-5f4a-4b6c-9d8e-0f1a2b3c4d5e';
    const key = signInSessionKey(
      asRequest({ sessionId: id, cookies: { [SESSION_COOKIE]: TOKEN } }),
    );
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toBe(signInSessionKey(withCookie(TOKEN)));
    expect(signInSessionKey(asRequest({ sessionId: id, cookies: {} }))).toBe(key);
  });
});

describe.skipIf(!hasDatabase)('Google sign-ins in progress', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  const laptop = signInSessionKey(withCookie(TOKEN)) ?? '';
  const phone = signInSessionKey(withCookie(`${TOKEN.slice(1)}x`)) ?? '';
  const now = new Date('2026-10-27T15:00:00Z');
  const save = (state: string, ownerId: string, at = now) =>
    saveOAuthState(
      test.db,
      { state, ownerId, sessionKey: laptop, workspaceId: null, codeVerifier: TEST_SEALED_SECRET },
      at,
    );

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin' });
    sam = await createUser(test.db, { name: 'Sam Ortiz' });
  });
  afterAll(async () => {
    await test?.close();
  });

  it('keeps only hashes, and ends a sign-in the first time it comes back', async () => {
    await save('state-one', avery.id);
    const [row] = await test.db.select().from(calendarOAuthStates);
    expect(row?.stateHash).toBe(hashOAuthState('state-one'));
    expect(row?.sessionKey).toBe(laptop);
    expect(JSON.stringify(row)).not.toContain('state-one');
    const by = { ownerId: avery.id, sessionKey: laptop };
    expect(await takeOAuthState(test.db, 'state-one', by, now)).toMatchObject({
      ownerId: avery.id,
      codeVerifier: TEST_SEALED_SECRET,
    });
    expect(await takeOAuthState(test.db, 'state-one', by, now)).toBeUndefined();
  });

  it("turns back another person's, another session's and an expired sign-in", async () => {
    await save('state-two', avery.id);
    expect(
      await takeOAuthState(test.db, 'state-two', { ownerId: sam.id, sessionKey: laptop }, now),
    ).toBeUndefined();
    // Another session: refused, and the sign-in is over.
    expect(
      await takeOAuthState(test.db, 'state-two', { ownerId: avery.id, sessionKey: phone }, now),
    ).toBeUndefined();
    expect(
      await takeOAuthState(test.db, 'state-two', { ownerId: avery.id, sessionKey: laptop }, now),
    ).toBeUndefined();

    await save('state-three', avery.id);
    const late = new Date(now.getTime() + OAUTH_STATE_TTL_MS + 1);
    expect(
      await takeOAuthState(test.db, 'state-three', { ownerId: avery.id, sessionKey: laptop }, late),
    ).toBeUndefined();
  });

  it('clears expired sign-ins when a new one starts', async () => {
    await save('state-four', sam.id, now);
    await save('state-five', sam.id, new Date(now.getTime() + OAUTH_STATE_TTL_MS + 1));
    const hashes = (await test.db.select().from(calendarOAuthStates)).map((row) => row.stateHash);
    expect(hashes).toEqual([hashOAuthState('state-five')]);
  });
});
