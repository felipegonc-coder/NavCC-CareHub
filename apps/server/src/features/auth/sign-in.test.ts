import { randomBytes } from 'node:crypto';
import { CSRF_COOKIE, CSRF_HEADER, meResponseSchema } from '@carehub/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp } from '../../testing';
import { csrfTokenForSession, newCsrfToken } from './csrf';
import type { EndedSession } from './events';
import { SIGN_IN_LIMIT } from './limits';
import { sessions, signInLimits } from './schema';
import { SESSION_COOKIE, createSession } from './sessions';

// Made up for each run, so no password is written here.
const newPassword = () => randomBytes(18).toString('base64url');
const WRONG = "That email and password don't match. Try again.";
const PAUSED = 'Too many wrong passwords. Wait 15 minutes and try again.';
const TOKEN = /^[\w-]{43}$/;

interface Browser {
  cookies: Record<string, string>;
  csrf: string;
}

const cookieOf = (response: LightMyRequestResponse, name: string) =>
  (response.cookies as Array<{ name: string; value: string; httpOnly?: boolean }>).find(
    (cookie) => cookie.name === name,
  );

/** A signed-out browser: only a CSRF cookie, which it sends back in the header. */
function signedOut(): Browser {
  const csrf = newCsrfToken();
  return { cookies: { [CSRF_COOKIE]: csrf }, csrf };
}

/** A browser with a session made directly (not through sign-in). */
async function signedInAs(test: TestApp, userId: string) {
  const session = await createSession(test.db, userId);
  const csrf = csrfTokenForSession(session.token);
  return {
    id: session.id,
    cookies: { [SESSION_COOKIE]: session.token, [CSRF_COOKIE]: csrf },
    csrf,
  };
}

/** After a successful sign-in, the browser keeps the cookies it was given. */
function browserFrom(response: LightMyRequestResponse): Browser {
  const token = cookieOf(response, SESSION_COOKIE)?.value ?? '';
  const csrf = cookieOf(response, CSRF_COOKIE)?.value ?? '';
  return { cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: csrf }, csrf };
}

function send(app: FastifyInstance, browser: Browser, options: InjectOptions) {
  const cookie = Object.entries(browser.cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return app.inject({
    ...options,
    headers: { cookie, [CSRF_HEADER]: browser.csrf, ...options.headers },
  });
}

describe.skipIf(!hasDatabase)('sign-in, sign-out and passwords', () => {
  let test: TestApp;
  let app: FastifyInstance;
  const ended: EndedSession[] = [];

  beforeAll(async () => {
    test = await createTestApp({
      routes: (instance) => {
        instance.get('/api/test/session', { config: { public: true } }, async (request) => ({
          sessionId: request.sessionId,
        }));
      },
    });
    app = test.app;
    app.events.on('session.ended', (session) => void ended.push(session));
  });

  afterAll(async () => {
    await test?.close();
  });

  const signIn = (email: string, password: string, browser: Browser = signedOut()) =>
    send(app, browser, { method: 'POST', url: '/api/auth/sign-in', payload: { email, password } });

  /** The session.ended events since the last call. */
  async function endedSince(): Promise<EndedSession[]> {
    await app.events.settled();
    return ended.splice(0);
  }

  describe('POST /api/auth/sign-in', () => {
    it('signs in with the right password, with new cookies and the same answer as me', async () => {
      const password = newPassword();
      const user = await createUser(test.db, { password });
      const response = await signIn(`  ${user.email.toUpperCase()} `, password);
      expect(response.statusCode).toBe(200);
      const body = meResponseSchema.parse(response.json());
      expect(body.user).toMatchObject({
        id: user.id,
        email: user.email,
        mustChangePassword: false,
      });
      expect(body.member).toMatchObject({ kind: 'member', roleName: 'Editor' });
      expect(body.workspace.name).toBe('Care Hub');

      const session = cookieOf(response, SESSION_COOKIE);
      expect(session?.value).toMatch(TOKEN);
      expect(session?.httpOnly).toBe(true);
      expect(cookieOf(response, CSRF_COOKIE)?.value).toBe(
        csrfTokenForSession(session?.value ?? ''),
      );
      const me = await send(app, browserFrom(response), { method: 'GET', url: '/api/auth/me' });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toEqual(response.json());
    });

    it('answers the same for a wrong password, an unknown email and an account without one', async () => {
      const password = newPassword();
      const user = await createUser(test.db, { password });
      const invited = await createUser(test.db);
      for (const response of [
        await signIn(user.email, newPassword()),
        await signIn(`nobody-${randomBytes(4).toString('hex')}@example.test`, password),
        await signIn(invited.email, password),
      ]) {
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: { code: 'signed_out', message: WRONG } });
        expect(cookieOf(response, SESSION_COOKIE)).toBeUndefined();
      }
    });

    it('checks the input', async () => {
      const response = await send(app, signedOut(), {
        method: 'POST',
        url: '/api/auth/sign-in',
        payload: { email: '', password: newPassword() },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatchObject({
        code: 'invalid',
        message: 'Enter your email.',
      });
    });

    it('needs the CSRF token and a same-site Origin', async () => {
      const password = newPassword();
      const user = await createUser(test.db, { password });
      const payload = { email: user.email, password };
      const noHeader = await app.inject({ method: 'POST', url: '/api/auth/sign-in', payload });
      expect(noHeader.statusCode).toBe(403);
      const elsewhere = await send(app, signedOut(), {
        method: 'POST',
        url: '/api/auth/sign-in',
        payload,
        headers: { origin: 'https://elsewhere.example' },
      });
      expect(elsewhere.statusCode).toBe(403);
    });

    it(`waits ${SIGN_IN_LIMIT.pauseMinutes} minutes after 10 wrong passwords, even for the right one`, async () => {
      const password = newPassword();
      const user = await createUser(test.db, { password });
      const unknown = `nobody-${randomBytes(4).toString('hex')}@example.test`;
      const other = await createUser(test.db, { password });
      for (let i = 0; i < SIGN_IN_LIMIT.failures; i++) {
        expect((await signIn(user.email, newPassword())).statusCode).toBe(401);
        expect((await signIn(unknown, newPassword())).statusCode).toBe(401);
      }
      for (const response of [
        await signIn(user.email, password),
        await signIn(unknown, password),
      ]) {
        expect(response.statusCode).toBe(429);
        expect(response.json()).toEqual({ error: { code: 'rate_limited', message: PAUSED } });
      }
      expect((await signIn(other.email, password)).statusCode).toBe(200);

      // The table keeps a hash of each name, never the name.
      const rows = await test.db.select().from(signInLimits);
      expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.nameHash))).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(user.email);

      // 15 minutes later.
      await test.db
        .update(signInLimits)
        .set({ windowStartedAt: sql`now() - interval '16 minutes'`, pausedUntil: sql`now()` });
      expect((await signIn(user.email, password)).statusCode).toBe(200);
      expect((await signIn(unknown, newPassword())).statusCode).toBe(401);
    });

    it('counts wrong passwords again after a right one, and only within 15 minutes', async () => {
      const password = newPassword();
      const user = await createUser(test.db, { password });
      const wrong = async (times: number) => {
        for (let i = 0; i < times; i++) await signIn(user.email, newPassword());
      };
      await wrong(SIGN_IN_LIMIT.failures - 1);
      expect((await signIn(user.email, password)).statusCode).toBe(200);
      await wrong(SIGN_IN_LIMIT.failures - 1);
      await test.db
        .update(signInLimits)
        .set({ windowStartedAt: sql`now() - interval '16 minutes'` });
      await wrong(1);
      expect((await signIn(user.email, password)).statusCode).toBe(200);
    });

    it('counts tries sent at the same time before it checks their passwords', async () => {
      const password = newPassword();
      const user = await createUser(test.db, { password });
      const tries = 25;
      const answers = await Promise.all(
        Array.from({ length: tries }, () => signIn(user.email, newPassword())),
      );
      const codes = answers.map((response) => response.statusCode);
      expect(codes.filter((code) => code === 401)).toHaveLength(SIGN_IN_LIMIT.failures);
      expect(codes.filter((code) => code === 429)).toHaveLength(tries - SIGN_IN_LIMIT.failures);
      expect((await signIn(user.email, password)).statusCode).toBe(429);
    });

    it('takes a password of 256 characters, even when they are emoji', async () => {
      // Different emoji, two UTF-16 units each.
      const password = Array.from({ length: 256 }, (_, i) =>
        String.fromCodePoint(0x1f400 + i),
      ).join('');
      const user = await createUser(test.db, { password });
      expect((await signIn(user.email, password)).statusCode).toBe(200);
    });

    it('turns a locked account away only after the right password', async () => {
      const password = newPassword();
      const user = await createUser(test.db, { password, locked: true });
      expect((await signIn(user.email, newPassword())).statusCode).toBe(401);
      const response = await signIn(user.email, password);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.message).toBe(
        'This account is locked. Ask a site admin to unlock it.',
      );
      expect(cookieOf(response, SESSION_COOKIE)).toBeUndefined();
    });

    it("ends the session the browser had before, and the new one isn't the same", async () => {
      const password = newPassword();
      const before = await createUser(test.db);
      const user = await createUser(test.db, { password });
      const browser = await signedInAs(test, before.id);
      await endedSince();
      const response = await signIn(user.email, password, browser);
      expect(response.statusCode).toBe(200);
      expect(response.json().user.id).toBe(user.id);
      expect(await test.db.select().from(sessions).where(eq(sessions.id, browser.id))).toEqual([]);
      expect(await endedSince()).toEqual([{ sessionId: browser.id, userId: before.id }]);
    });

    it('lets a temporary password do only me, password and sign-out until it is replaced', async () => {
      const password = newPassword();
      const user = await createUser(test.db, { password, mustChangePassword: true });
      const response = await signIn(user.email, password);
      expect(response.statusCode).toBe(200);
      expect(response.json().user.mustChangePassword).toBe(true);
      const browser = browserFrom(response);
      const everywhere = { method: 'POST', url: '/api/auth/sign-out-everywhere' } as const;
      expect((await send(app, browser, everywhere)).statusCode).toBe(403);

      const changed = await send(app, browser, {
        method: 'POST',
        url: '/api/auth/password',
        payload: { currentPassword: password, newPassword: newPassword() },
      });
      expect(changed.statusCode).toBe(200);
      expect(changed.json().user.mustChangePassword).toBe(false);
      expect((await send(app, browser, everywhere)).statusCode).toBe(200);
    });
  });

  describe('sessions', () => {
    it('puts the session ID on the request, never the token', async () => {
      const user = await createUser(test.db);
      const browser = await signedInAs(test, user.id);
      const signedInAnswer = await send(app, browser, { method: 'GET', url: '/api/test/session' });
      expect(signedInAnswer.json()).toEqual({ sessionId: browser.id });
      const signedOutAnswer = await send(app, signedOut(), {
        method: 'GET',
        url: '/api/test/session',
      });
      expect(signedOutAnswer.json()).toEqual({ sessionId: null });
    });

    it('sign-out ends this session and says so', async () => {
      const user = await createUser(test.db);
      const browser = await signedInAs(test, user.id);
      await endedSince();
      const response = await send(app, browser, { method: 'POST', url: '/api/auth/sign-out' });
      expect(response.statusCode).toBe(200);
      expect(await endedSince()).toEqual([{ sessionId: browser.id, userId: user.id }]);
    });

    it('sign-out everywhere ends every session of this person, this one too', async () => {
      const user = await createUser(test.db);
      const someoneElse = await signedInAs(test, (await createUser(test.db)).id);
      const laptop = await signedInAs(test, user.id);
      const phone = await signedInAs(test, user.id);
      await endedSince();
      const response = await send(app, laptop, {
        method: 'POST',
        url: '/api/auth/sign-out-everywhere',
      });
      expect(response.statusCode).toBe(200);
      expect(cookieOf(response, SESSION_COOKIE)?.value).toBe('');
      for (const browser of [laptop, phone]) {
        expect((await send(app, browser, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(
          401,
        );
      }
      expect(
        (await send(app, someoneElse, { method: 'GET', url: '/api/auth/me' })).statusCode,
      ).toBe(200);
      const events = await endedSince();
      expect(events.map((event) => event.sessionId).sort()).toEqual([laptop.id, phone.id].sort());
      expect(events.every((event) => event.userId === user.id)).toBe(true);
    });
  });

  describe('POST /api/auth/password', () => {
    it('checks the current password and the rules, then signs out the other devices', async () => {
      const password = newPassword();
      const user = await createUser(test.db, { password });
      const laptop = await signedInAs(test, user.id);
      const phone = await signedInAs(test, user.id);
      await endedSince();
      const change = (body: { currentPassword: string; newPassword: string }) =>
        send(app, laptop, { method: 'POST', url: '/api/auth/password', payload: body });
      const next = newPassword();

      const wrong = await change({ currentPassword: newPassword(), newPassword: next });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error).toMatchObject({
        code: 'invalid',
        message: "That isn't your current password.",
        details: [{ path: ['currentPassword'] }],
      });
      const refused = {
        [next.slice(0, 11)]: 'Use at least 12 characters.',
        [['pass', 'word', '1234'].join('')]: 'This password is too easy to guess.',
        [user.email]: "Don't use your email in your password.",
        [password]: 'Choose a new password, not the one you have now.',
      };
      for (const [candidate, message] of Object.entries(refused)) {
        const response = await change({ currentPassword: password, newPassword: candidate });
        expect(response.statusCode, message).toBe(400);
        expect(response.json().error.message).toContain(message);
        expect(response.json().error.details).toMatchObject([{ path: ['newPassword'] }]);
      }

      const changed = await change({ currentPassword: password, newPassword: next });
      expect(changed.statusCode).toBe(200);
      expect((await send(app, laptop, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(
        200,
      );
      expect((await send(app, phone, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
      expect(await endedSince()).toEqual([{ sessionId: phone.id, userId: user.id }]);
      expect((await signIn(user.email, password)).statusCode).toBe(401);
      expect((await signIn(user.email, next)).statusCode).toBe(200);
    });

    const changeFor = (browser: Browser) => (currentPassword: string, next: string) =>
      send(app, browser, {
        method: 'POST',
        url: '/api/auth/password',
        payload: { currentPassword, newPassword: next },
      });

    it('counts wrong current passwords like wrong sign-ins, and only wrong ones', async () => {
      const password = newPassword();
      const user = await createUser(test.db, { password });
      const change = changeFor(await signedInAs(test, user.id));
      // The right current password with a new one that can't be used doesn't count.
      for (let i = 0; i < SIGN_IN_LIMIT.failures; i++) {
        expect((await change(password, password)).json().error.details).toMatchObject([
          { path: ['newPassword'] },
        ]);
      }
      for (let i = 0; i < SIGN_IN_LIMIT.failures; i++) {
        expect((await change(newPassword(), newPassword())).json().error.details).toMatchObject([
          { path: ['currentPassword'] },
        ]);
      }
      expect((await signIn(user.email, password)).statusCode).toBe(429);
    });

    it('counts current passwords sent at the same time before it checks them', async () => {
      const user = await createUser(test.db, { password: newPassword() });
      const change = changeFor(await signedInAs(test, user.id));
      const tries = 25;
      const answers = await Promise.all(
        Array.from({ length: tries }, () => change(newPassword(), newPassword())),
      );
      const codes = answers.map((response) => response.statusCode);
      expect(codes.filter((code) => code === 400)).toHaveLength(SIGN_IN_LIMIT.failures);
      expect(codes.filter((code) => code === 429)).toHaveLength(tries - SIGN_IN_LIMIT.failures);
    });
  });
});
