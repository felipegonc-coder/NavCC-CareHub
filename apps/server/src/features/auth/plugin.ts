import cookie from '@fastify/cookie';
import { CSRF_HEADER, hasPermission, type CurrentUser, type PermissionKey } from '@carehub/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { httpError } from '../../core/errors';
import { getCurrentMember, syncDefaultWorkspace, type CurrentMember } from '../workspaces';
import { rememberSession, sessionCookies, sessionOf, type SessionCookies } from './cookies';
import { checkCsrf } from './csrf';
import { findSession, sessionNeedsTouch, touchSession } from './sessions';

/** A Fastify preHandler that answers 401 or 403 unless the request is allowed. */
export type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Reachable without signing in. Every other /api route needs a signed-in user (default-deny). */
    public?: boolean;
    /** Works while the person must still replace a temporary password (me, password, sign-out). */
    allowTemporaryPassword?: boolean;
    /** Guests may use it too (pages and comments shared with them). requireMember refuses guests otherwise. */
    allowGuests?: boolean;
  }
  interface FastifyRequest {
    /** The signed-in person on /api routes, or null. */
    user: CurrentUser | null;
    /** The signed-in person's membership of the current workspace (members and guests), or null. */
    member: CurrentMember | null;
  }
  interface FastifyInstance {
    /** The auth cookies: `names` (they depend on COOKIE_SECURE), `sessionToken(request)`, set and clear. */
    sessionCookies: SessionCookies;
    /** 401 unless signed in (for routes that are public otherwise). */
    requireUser: Guard;
    /** 401 unless signed in; 403 unless a site admin. */
    requireSiteAdmin: Guard;
    /** 401 unless signed in; 403 unless in the workspace (guests only where the route has allowGuests). */
    requireMember: Guard;
    /** requireMember, then 403 unless the person's role includes `key` (always 403 for guests). */
    requirePermission: (key: PermissionKey) => Guard;
  }
}

export interface AuthPluginOptions {
  /** Secure cookies (COOKIE_SECURE). */
  cookieSecure: boolean;
  /** CAREHUB_PUBLIC_URL. When it's unset, a request's Origin must match its Host header. */
  publicUrl?: string | undefined;
}

// Uses the matched route, not the raw URL, so a path spelled differently (/%61pi/…) can't skip the checks.
const API_ROUTE = /^\/api(?:\/|$)/;
/**
 * The only routes allowed outside /api, where default-deny and the CSRF checks don't run: the web app's
 * files. Anything new here (feeds, downloads, share links) needs a security review first.
 */
const REVIEWED_ROUTES_OUTSIDE_API: ReadonlySet<string> = new Set(['/*']);
const CSRF_MESSAGES = {
  origin: 'This request came from another site, so it was blocked.',
  token: 'The security check failed. Reload the page and try again.',
};

/**
 * Sessions, CSRF checks, `request.user`, `request.member` and the guards. Register after the database.
 * At start-up it also makes sure the current workspace and its built-in roles are in place.
 */
export const authPlugin = fp<AuthPluginOptions>(
  async (app, options) => {
    const cookies = sessionCookies(options.cookieSecure);
    const publicOrigin = options.publicUrl ? new URL(options.publicUrl).origin : null;
    await syncDefaultWorkspace(app.db);
    await app.register(cookie);
    app.decorate('sessionCookies', cookies);
    app.decorateRequest('user', null);
    app.decorateRequest('member', null);

    app.addHook('onRoute', (route) => {
      if (API_ROUTE.test(route.url) || REVIEWED_ROUTES_OUTSIDE_API.has(route.url)) return;
      throw new Error(
        `${route.method} ${route.url} is outside /api, where sign-in and CSRF checks don't run. ` +
          'Move it under /api, or have it reviewed and added in features/auth/plugin.ts.',
      );
    });

    app.addHook('onRequest', async (request, reply) => {
      const route = request.routeOptions.url;
      if (route === undefined || !API_ROUTE.test(route)) return;
      const token = cookies.sessionToken(request);
      if (token) {
        const session = await findSession(app.db, token);
        if (session) {
          request.user = session.user;
          rememberSession(request, { id: session.id, token });
          if (sessionNeedsTouch(session.lastSeenAt)) {
            await touchSession(app.db, session.id);
            cookies.set(reply, token);
          }
        } else {
          cookies.clear(reply);
        }
      }
      cookies.ensureCsrf(request, reply);

      const config = request.routeOptions.config;
      if (!config.public) {
        if (!request.user) throw httpError(401, 'signed_out');
        if (request.user.mustChangePassword && !config.allowTemporaryPassword) {
          throw httpError(403, 'forbidden', 'Choose a new password to continue.');
        }
      }
      const failure = checkCsrf({
        method: request.method,
        origin: request.headers.origin,
        host: request.headers.host,
        publicOrigin,
        header: request.headers[CSRF_HEADER],
        cookie: cookies.csrfToken(request),
        sessionToken: sessionOf(request)?.token,
      });
      if (failure) throw httpError(403, 'forbidden', CSRF_MESSAGES[failure]);
      if (request.user) request.member = await getCurrentMember(app.db, request.user.id);
    });

    const signedIn = (request: FastifyRequest): CurrentUser => {
      if (!request.user) throw httpError(401, 'signed_out');
      return request.user;
    };
    app.decorate('requireUser', async (request: FastifyRequest) => void signedIn(request));
    app.decorate('requireSiteAdmin', async (request: FastifyRequest) => {
      if (!signedIn(request).isSiteAdmin) throw httpError(403, 'forbidden');
    });
    const inWorkspace = (request: FastifyRequest): CurrentMember => {
      signedIn(request);
      const { member } = request;
      if (!member) throw httpError(403, 'forbidden');
      if (member.kind === 'guest' && !request.routeOptions.config.allowGuests) {
        throw httpError(403, 'forbidden');
      }
      return member;
    };
    app.decorate('requireMember', async (request: FastifyRequest) => void inWorkspace(request));
    app.decorate('requirePermission', (key: PermissionKey): Guard => async (request) => {
      if (!hasPermission(inWorkspace(request), key)) throw httpError(403, 'forbidden');
    });
  },
  { name: 'carehub-auth', fastify: '5.x', dependencies: ['carehub-database'] },
);
