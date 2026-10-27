import { createHash } from 'node:crypto';
import { BUILT_IN_ROLES, CSRF_COOKIE, CSRF_HEADER, currentUserSchema } from '@carehub/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, createUser, hasDatabase, injectAs, type TestApp } from '../../testing';
import { csrfTokenForSession, newCsrfToken } from './csrf';
import { sessions, users } from './schema';
import { SESSION_COOKIE, createSession, getUserFromSessionToken } from './sessions';

const THIRTY_DAYS = 30 * 24 * 60 * 60;
const TOKEN = /^[\w-]{43}$/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

interface ResponseCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}
const cookieOf = (response: LightMyRequestResponse, name: string) =>
  (response.cookies as ResponseCookie[]).find((cookie) => cookie.name === name);

/** A request with exactly these cookies and headers. */
function send(
  app: FastifyInstance,
  options: InjectOptions & { cookies?: Record<string, string> },
): Promise<LightMyRequestResponse> {
  const { cookies = {}, headers = {}, ...rest } = options;
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return app.inject({ ...rest, headers: { ...headers, ...(cookie ? { cookie } : {}) } });
}

describe.skipIf(!hasDatabase)('accounts: sessions, me and guards', () => {
  let testApp: TestApp;
  let app: FastifyInstance;
  let logs: string[];

  beforeAll(async () => {
    logs = [];
    testApp = await createTestApp({
      logger: { level: 'trace', stream: { write: (line: string) => void logs.push(line) } },
      routes: (instance) => {
        instance.get('/api/test/private', async (request) => ({ id: request.user?.id }));
        instance.post('/api/test/private', async () => ({ ok: true }));
        instance.get('/api/test/open', { config: { public: true } }, async (request) => ({
          user: request.user?.id ?? null,
          member: request.member?.kind ?? null,
        }));
        instance.get('/api/test/site', { preHandler: instance.requireSiteAdmin }, async () => ({
          ok: true,
        }));
        instance.get(
          '/api/test/open-user',
          { config: { public: true }, preHandler: instance.requireUser },
          async () => ({ ok: true }),
        );
      },
    });
    app = testApp.app;
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const sessionRows = (userId: string) =>
    testApp.db.select().from(sessions).where(eq(sessions.userId, userId));

  /** A session's cookies and CSRF header, as a signed-in browser sends them. */
  async function browserFor(userId: string) {
    const { token } = await createSession(testApp.db, userId);
    const csrf = csrfTokenForSession(token);
    return { token, cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: csrf }, csrf };
  }

  describe('default-deny', () => {
    it('answers 401 on /api routes without config.public when signed out', async () => {
      const response = await send(app, { method: 'GET', url: '/api/test/private' });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: { code: 'signed_out', message: 'Sign in to continue.' },
      });
      expect((await send(app, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    });

    it('lets public routes through', async () => {
      expect((await send(app, { method: 'GET', url: '/api/test/open' })).statusCode).toBe(200);
      expect((await send(app, { method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    });

    it('checks the route that matched, however the path is spelled', async () => {
      const response = await send(app, { method: 'GET', url: '/%61pi/test/private' });
      expect([401, 404]).toContain(response.statusCode);
    });

    it('refuses to start with a route outside /api that nobody reviewed', async () => {
      await expect(
        createTestApp({
          routes: (instance) => void instance.get('/feeds/calendar.ics', async () => 'BEGIN'),
        }),
      ).rejects.toThrow(/GET \/feeds\/calendar\.ics is outside \/api/);
    });

    it('requireUser still guards a public route', async () => {
      expect((await send(app, { method: 'GET', url: '/api/test/open-user' })).statusCode).toBe(401);
      const user = await createUser(testApp.db);
      const response = await injectAs(app, user, { method: 'GET', url: '/api/test/open-user' });
      expect(response.statusCode).toBe(200);
    });
    it('on public routes, a failed session lookup (database down) counts as signed out', async () => {
      const user = await createUser(testApp.db);
      const { token, cookies } = await browserFor(user.id);
      const select = vi.spyOn(testApp.db, 'select').mockImplementation(() => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
      });
      try {
        const open = await send(app, { method: 'GET', url: '/api/test/open', cookies });
        expect(open.statusCode).toBe(200);
        expect(open.json()).toEqual({ user: null, member: null });
        expect(cookieOf(open, SESSION_COOKIE)).toBeUndefined();
        expect(cookieOf(open, CSRF_COOKIE)).toBeUndefined();
        const closed = await send(app, { method: 'GET', url: '/api/test/private', cookies });
        expect(closed.statusCode).toBe(500);
      } finally {
        select.mockRestore();
      }
      const warning = logs.find((line) => line.includes('session lookup failed'));
      expect(JSON.parse(warning ?? '{}')).toMatchObject({
        level: 40,
        error: { message: 'connect ECONNREFUSED 10.0.0.5:5432' },
      });
      expect(logs.join('\n')).not.toContain(token);
      const back = await send(app, { method: 'GET', url: '/api/test/open', cookies });
      expect(back.json()).toEqual({ user: user.id, member: 'member' });
    });
  });

  describe('GET /api/auth/me', () => {
    it('issues a readable CSRF cookie to signed-out browsers, once', async () => {
      const first = await send(app, { method: 'GET', url: '/api/auth/me' });
      const csrf = cookieOf(first, CSRF_COOKIE);
      expect(csrf).toMatchObject({ path: '/', sameSite: 'Lax', maxAge: THIRTY_DAYS });
      expect(csrf?.httpOnly).toBeFalsy();
      expect(csrf?.value).toMatch(TOKEN);
      const second = await send(app, {
        method: 'GET',
        url: '/api/auth/me',
        cookies: { [CSRF_COOKIE]: csrf?.value ?? '' },
      });
      expect(cookieOf(second, CSRF_COOKIE)).toBeUndefined();
    });

    it('returns the signed-in person, their membership and the workspace', async () => {
      const user = await createUser(testApp.db, { name: 'Riley Chen' });
      const response = await injectAs(app, user, { method: 'GET', url: '/api/auth/me' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        user: {
          id: user.id,
          email: user.email,
          name: 'Riley Chen',
          avatarUrl: null,
          isSiteAdmin: false,
          timeZone: 'America/Denver',
          use24h: false,
          weekStart: 0,
          mustChangePassword: false,
        },
        member: {
          kind: 'member',
          workspaceId: user.workspaceId,
          roleId: user.roleId,
          roleName: 'Editor',
          permissions: [...BUILT_IN_ROLES.editor.permissions],
          isAdmin: false,
        },
        workspace: { id: user.workspaceId, name: 'Care Hub' },
      });
    });
  });

  describe('requireSiteAdmin', () => {
    it('lets only site admins through', async () => {
      const person = await createUser(testApp.db);
      const siteAdmin = await createUser(testApp.db, { siteAdmin: true });
      const refused = await injectAs(app, person, { method: 'GET', url: '/api/test/site' });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toEqual({
        error: { code: 'forbidden', message: "You don't have access to this." },
      });
      const allowed = await injectAs(app, siteAdmin, { method: 'GET', url: '/api/test/site' });
      expect(allowed.statusCode).toBe(200);
    });
  });

  describe('temporary passwords', () => {
    it('allow only me (and sign-out) until a new password is chosen', async () => {
      const user = await createUser(testApp.db, { mustChangePassword: true });
      const blocked = await injectAs(app, user, { method: 'GET', url: '/api/test/private' });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.message).toBe('Choose a new password to continue.');
      const me = await injectAs(app, user, { method: 'GET', url: '/api/auth/me' });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.mustChangePassword).toBe(true);
      const { token } = await browserFor(user.id);
      expect(await getUserFromSessionToken(testApp.db, token)).toBeNull();
    });
  });

  describe('CSRF and Origin checks', () => {
    it('need the session-bound token in X-CSRF-Token on state-changing requests', async () => {
      const user = await createUser(testApp.db);
      const browser = await browserFor(user.id);
      const post = (headers: Record<string, string>, cookies = browser.cookies) =>
        send(app, { method: 'POST', url: '/api/test/private', cookies, headers });
      expect((await post({ [CSRF_HEADER]: browser.csrf })).statusCode).toBe(200);
      const missing = await post({});
      expect(missing.statusCode).toBe(403);
      expect(missing.json().error).toEqual({
        code: 'forbidden',
        message: 'The security check failed. Reload the page and try again.',
      });
      expect((await post({ [CSRF_HEADER]: newCsrfToken() })).statusCode).toBe(403);
      // A cookie planted from another site on a shared parent domain, sent back in the header too.
      const planted = newCsrfToken();
      const plantedCookies = { ...browser.cookies, [CSRF_COOKIE]: planted };
      expect((await post({ [CSRF_HEADER]: planted }, plantedCookies)).statusCode).toBe(403);
      // GET requests don't need it, and the browser gets the right cookie back.
      const get = await send(app, {
        method: 'GET',
        url: '/api/test/private',
        cookies: plantedCookies,
      });
      expect(get.statusCode).toBe(200);
      expect(cookieOf(get, CSRF_COOKIE)?.value).toBe(browser.csrf);
    });

    it('refuse requests from other sites', async () => {
      const user = await createUser(testApp.db);
      const browser = await browserFor(user.id);
      const host = 'carehub.example.test';
      const post = (origin: string) =>
        send(app, {
          method: 'POST',
          url: '/api/test/private',
          cookies: browser.cookies,
          headers: { host, origin, [CSRF_HEADER]: browser.csrf },
        });
      const crossSite = await post('https://elsewhere.example.test');
      expect(crossSite.statusCode).toBe(403);
      expect(crossSite.json().error.message).toContain('another site');
      expect((await post(`https://${host}`)).statusCode).toBe(200);
    });

    it('accept only the CAREHUB_PUBLIC_URL origin when it is set', async () => {
      const behindProxy = await createTestApp({
        env: { CAREHUB_PUBLIC_URL: 'https://carehub.example.test' },
      });
      try {
        const user = await createUser(behindProxy.db);
        const { token } = await createSession(behindProxy.db, user.id);
        const csrf = csrfTokenForSession(token);
        const post = (origin: string) =>
          send(behindProxy.app, {
            method: 'POST',
            url: '/api/auth/sign-out',
            cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: csrf },
            headers: { host: 'localhost:3000', origin, [CSRF_HEADER]: csrf },
          });
        expect((await post('http://localhost:3000')).statusCode).toBe(403);
        expect((await post('https://carehub.example.test')).statusCode).toBe(200);
      } finally {
        await behindProxy.close();
      }
    });
  });

  describe('sessions', () => {
    it('store only a hash of the token', async () => {
      const user = await createUser(testApp.db);
      const { token } = await browserFor(user.id);
      expect(token).toMatch(TOKEN);
      const rows = await sessionRows(user.id);
      expect(rows.map((row) => row.tokenHash)).toEqual([sha256(token)]);
    });

    it('record the device and the last active time', async () => {
      const user = await createUser(testApp.db);
      await createSession(testApp.db, user.id, { userAgent: 'Firefox', ipAddress: '100.64.0.7' });
      const [row] = await sessionRows(user.id);
      expect(row).toMatchObject({ userAgent: 'Firefox', ipAddress: '100.64.0.7' });
      const [account] = await testApp.db
        .select({ lastActiveAt: users.lastActiveAt })
        .from(users)
        .where(eq(users.id, user.id));
      expect(account?.lastActiveAt).toBeInstanceOf(Date);
    });

    it('slide the 30-day expiry forward when used', async () => {
      const user = await createUser(testApp.db);
      const browser = await browserFor(user.id);
      await testApp.db
        .update(sessions)
        .set({
          lastSeenAt: sql`now() - interval '10 minutes'`,
          expiresAt: sql`now() + interval '1 day'`,
        })
        .where(eq(sessions.userId, user.id));
      const response = await send(app, {
        method: 'GET',
        url: '/api/auth/me',
        cookies: browser.cookies,
      });
      expect(response.statusCode).toBe(200);
      expect(cookieOf(response, SESSION_COOKIE)).toMatchObject({
        value: browser.token,
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: THIRTY_DAYS,
      });
      const [row] = await sessionRows(user.id);
      expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + (THIRTY_DAYS - 3600) * 1000);
      const again = await send(app, {
        method: 'GET',
        url: '/api/auth/me',
        cookies: browser.cookies,
      });
      expect(cookieOf(again, SESSION_COOKIE)).toBeUndefined();
    });

    it('end 90 days after sign-in, however often they are used', async () => {
      const user = await createUser(testApp.db);
      const browser = await browserFor(user.id);
      await testApp.db
        .update(sessions)
        .set({
          createdAt: sql`now() - interval '89 days 23 hours'`,
          lastSeenAt: sql`now() - interval '10 minutes'`,
        })
        .where(eq(sessions.userId, user.id));
      const me = () => send(app, { method: 'GET', url: '/api/auth/me', cookies: browser.cookies });
      expect((await me()).statusCode).toBe(200);
      const [row] = await sessionRows(user.id);
      // It slid forward only to 90 days after sign-in (an hour from now), not by 30 days.
      expect(row?.expiresAt.getTime()).toBeLessThan(Date.now() + 2 * 60 * 60 * 1000);
      await testApp.db
        .update(sessions)
        .set({ createdAt: sql`now() - interval '90 days 1 minute'` })
        .where(eq(sessions.userId, user.id));
      expect((await me()).statusCode).toBe(401);
    });

    it('use Secure __Host- cookies with the default settings, and ignore plain ones', async () => {
      const secure = await createTestApp({ env: { COOKIE_SECURE: undefined } });
      try {
        const { names } = secure.app.sessionCookies;
        expect(names).toEqual({ session: '__Host-carehub_session', csrf: '__Host-carehub_csrf' });
        const signedOut = await send(secure.app, { method: 'GET', url: '/api/auth/me' });
        expect(cookieOf(signedOut, names.csrf)).toMatchObject({ secure: true, path: '/' });
        const user = await createUser(secure.db);
        const { token } = await createSession(secure.db, user.id);
        await secure.db
          .update(sessions)
          .set({ lastSeenAt: sql`now() - interval '10 minutes'` })
          .where(eq(sessions.userId, user.id));
        const cookies = { [names.session]: token, [names.csrf]: csrfTokenForSession(token) };
        const response = await send(secure.app, { method: 'GET', url: '/api/auth/me', cookies });
        expect(response.statusCode).toBe(200);
        const session = cookieOf(response, names.session);
        expect(session).toMatchObject({
          value: token,
          secure: true,
          httpOnly: true,
          sameSite: 'Lax',
          path: '/',
        });
        expect(session?.domain).toBeUndefined();
        const plain = await send(secure.app, {
          method: 'GET',
          url: '/api/auth/me',
          cookies: { [SESSION_COOKIE]: token },
        });
        expect(plain.statusCode).toBe(401);
      } finally {
        await secure.close();
      }
    });

    it('end when expired, and the cookie is cleared', async () => {
      const user = await createUser(testApp.db);
      const browser = await browserFor(user.id);
      await testApp.db
        .update(sessions)
        .set({ expiresAt: sql`now() - interval '1 second'` })
        .where(eq(sessions.userId, user.id));
      const response = await send(app, {
        method: 'GET',
        url: '/api/auth/me',
        cookies: browser.cookies,
      });
      expect(response.statusCode).toBe(401);
      expect(cookieOf(response, SESSION_COOKIE)?.value).toBe('');
    });

    it('stop working when the account is locked', async () => {
      const user = await createUser(testApp.db);
      const browser = await browserFor(user.id);
      await testApp.db.update(users).set({ lockedAt: new Date() }).where(eq(users.id, user.id));
      const response = await send(app, {
        method: 'GET',
        url: '/api/auth/me',
        cookies: browser.cookies,
      });
      expect(response.statusCode).toBe(401);
      expect(await getUserFromSessionToken(testApp.db, browser.token)).toBeNull();
    });

    it('getUserFromSessionToken finds the person behind a live token', async () => {
      const user = await createUser(testApp.db);
      const { token } = await browserFor(user.id);
      // The CurrentUser part of the test user (without workspaceId and roleId).
      expect(await getUserFromSessionToken(testApp.db, token)).toEqual(
        currentUserSchema.parse(user),
      );
      expect(await getUserFromSessionToken(testApp.db, 'not-a-token')).toBeNull();
      expect(await getUserFromSessionToken(testApp.db, sha256(token))).toBeNull();
    });
  });

  describe('POST /api/auth/sign-out', () => {
    it('ends this session only and clears the cookie', async () => {
      const user = await createUser(testApp.db);
      const laptop = await browserFor(user.id);
      const phone = await browserFor(user.id);
      const response = await send(app, {
        method: 'POST',
        url: '/api/auth/sign-out',
        cookies: laptop.cookies,
        headers: { [CSRF_HEADER]: laptop.csrf },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(cookieOf(response, SESSION_COOKIE)?.value).toBe('');
      expect(cookieOf(response, CSRF_COOKIE)?.value).toMatch(TOKEN);
      const replay = await send(app, {
        method: 'GET',
        url: '/api/auth/me',
        cookies: laptop.cookies,
      });
      expect(replay.statusCode).toBe(401);
      const still = await send(app, { method: 'GET', url: '/api/auth/me', cookies: phone.cookies });
      expect(still.statusCode).toBe(200);
    });

    it('works without a session, but still needs the CSRF token', async () => {
      const csrf = newCsrfToken();
      const post = (headers: Record<string, string>) =>
        send(app, {
          method: 'POST',
          url: '/api/auth/sign-out',
          cookies: { [CSRF_COOKIE]: csrf },
          headers,
        });
      expect((await post({})).statusCode).toBe(403);
      expect((await post({ [CSRF_HEADER]: csrf })).statusCode).toBe(200);
    });
  });

  describe('testing helpers', () => {
    it('createUser makes a fictional Editor at example.test, or someone outside the workspace', async () => {
      const user = await createUser(testApp.db);
      expect(user.email).toMatch(/^editor-[0-9a-f]+@example\.test$/);
      expect(user).toMatchObject({ name: 'Test Editor', isSiteAdmin: false });
      expect(user.roleId).toEqual(expect.any(String));
      const outsider = await createUser(testApp.db, { role: null });
      expect(outsider.email).toMatch(/^person-[0-9a-f]+@example\.test$/);
      expect(outsider).toMatchObject({ name: 'Test Person', workspaceId: null, roleId: null });
    });

    it('injectAs sends the CSRF header on state-changing requests', async () => {
      const user = await createUser(testApp.db);
      const response = await injectAs(app, user, { method: 'POST', url: '/api/test/private' });
      expect(response.statusCode).toBe(200);
    });
  });

  it('never logs session tokens or cookies', async () => {
    const user = await createUser(testApp.db);
    const browser = await browserFor(user.id);
    await send(app, { method: 'GET', url: '/api/auth/me', cookies: browser.cookies });
    expect(logs.length).toBeGreaterThan(0);
    const text = logs.join('\n');
    expect(text).not.toContain(browser.token);
    expect(text).not.toContain(browser.csrf);
    expect(text).not.toContain(`${SESSION_COOKIE}=`);
  });
});
