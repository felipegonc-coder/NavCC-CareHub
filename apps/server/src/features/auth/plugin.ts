import cookie from '@fastify/cookie';
import { CSRF_COOKIE, CSRF_HEADER, type CurrentUser } from '@carehub/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { httpError } from '../../core/errors';
import { rememberSession, sessionCookies, sessionOf, type SessionCookies } from './cookies';
import { checkCsrf } from './csrf';
import { SESSION_COOKIE, findSession, sessionNeedsTouch, touchSession } from './sessions';

/** A Fastify preHandler that answers 401 or 403 unless the request is allowed. */
export type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Reachable without signing in. Every other /api route needs a signed-in user (default-deny). */
    public?: boolean;
    /** Works while the person must still replace a temporary password (me, password, sign-out). */
    allowTemporaryPassword?: boolean;
  }
  interface FastifyRequest {
    /** The signed-in person on /api routes, or null. */
    user: CurrentUser | null;
  }
  interface FastifyInstance {
    sessionCookies: SessionCookies;
    /** 401 unless signed in (for routes that are public otherwise). */
    requireUser: Guard;
    /** 401 unless signed in; 403 unless a site admin. */
    requireSiteAdmin: Guard;
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
const CSRF_MESSAGES = {
  origin: 'This request came from another site, so it was blocked.',
  token: 'The security check failed. Reload the page and try again.',
};

/** Sessions, CSRF checks, `request.user` and the guards. Register after the database. */
export const authPlugin = fp<AuthPluginOptions>(
  async (app, options) => {
    const cookies = sessionCookies(options.cookieSecure);
    const publicOrigin = options.publicUrl ? new URL(options.publicUrl).origin : null;
    await app.register(cookie);
    app.decorate('sessionCookies', cookies);
    app.decorateRequest('user', null);

    app.addHook('onRequest', async (request, reply) => {
      const route = request.routeOptions.url;
      if (route === undefined || !API_ROUTE.test(route)) return;
      const token = request.cookies[SESSION_COOKIE];
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
        cookie: request.cookies[CSRF_COOKIE],
        sessionToken: sessionOf(request)?.token,
      });
      if (failure) throw httpError(403, 'forbidden', CSRF_MESSAGES[failure]);
    });

    const signedIn = (request: FastifyRequest): CurrentUser => {
      if (!request.user) throw httpError(401, 'signed_out');
      return request.user;
    };
    app.decorate('requireUser', async (request: FastifyRequest) => void signedIn(request));
    app.decorate('requireSiteAdmin', async (request: FastifyRequest) => {
      if (!signedIn(request).isSiteAdmin) throw httpError(403, 'forbidden');
    });
  },
  { name: 'carehub-auth', fastify: '5.x', dependencies: ['carehub-database'] },
);
