import { CSRF_COOKIE, SECURE_COOKIE_PREFIX } from '@carehub/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { csrfTokenForSession, isWellFormedCsrfToken, newCsrfToken } from './csrf';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './sessions';

export interface RequestSession {
  id: string;
  token: string;
}

/** The session behind each signed-in request. Kept off `request`, so the token can't end up in a log. */
const requestSessions = new WeakMap<FastifyRequest, RequestSession>();

export const sessionOf = (request: FastifyRequest) => requestSessions.get(request);
export const rememberSession = (request: FastifyRequest, session: RequestSession) =>
  void requestSessions.set(request, session);

export interface AuthCookieNames {
  session: string;
  csrf: string;
}

/**
 * `__Host-carehub_session` and `__Host-carehub_csrf` when cookies are Secure: only this exact host can set
 * those, so a site on a shared parent domain can't plant its own session. Plain names for local HTTP.
 */
export function authCookieNames(secure: boolean): AuthCookieNames {
  const prefix = secure ? SECURE_COOKIE_PREFIX : '';
  return { session: prefix + SESSION_COOKIE, csrf: prefix + CSRF_COOKIE };
}

export type SessionCookies = ReturnType<typeof sessionCookies>;

export function sessionCookies(secure: boolean) {
  const names = authCookieNames(secure);
  const base = { path: '/', secure, sameSite: 'lax' as const };
  const setCsrf = (reply: FastifyReply, value: string) =>
    reply.setCookie(names.csrf, value, { ...base, httpOnly: false, maxAge: SESSION_TTL_SECONDS });
  return {
    names,
    /** The session token the request carries, if any (for example on the co-editing connection). */
    sessionToken: (request: FastifyRequest): string | undefined => request.cookies[names.session],
    csrfToken: (request: FastifyRequest): string | undefined => request.cookies[names.csrf],
    /** After sign-in, and whenever the session's expiry slides forward. */
    set(reply: FastifyReply, token: string) {
      reply.setCookie(names.session, token, {
        ...base,
        httpOnly: true,
        maxAge: SESSION_TTL_SECONDS,
      });
      setCsrf(reply, csrfTokenForSession(token));
    },
    /** After sign-out, or for a dead session: drop the session cookie and start a fresh CSRF token. */
    clear(reply: FastifyReply) {
      reply.clearCookie(names.session, { ...base, httpOnly: true });
      setCsrf(reply, newCsrfToken());
    },
    /** Issues the CSRF cookie when it's missing or doesn't belong to the current session. */
    ensureCsrf(request: FastifyRequest, reply: FastifyReply) {
      const session = sessionOf(request);
      const current = request.cookies[names.csrf];
      if (session) {
        const expected = csrfTokenForSession(session.token);
        if (current !== expected) setCsrf(reply, expected);
      } else if (!isWellFormedCsrfToken(current)) {
        setCsrf(reply, newCsrfToken());
      }
    },
  };
}
