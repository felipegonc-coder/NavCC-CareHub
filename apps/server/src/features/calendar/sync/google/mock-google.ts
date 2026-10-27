// Test support only; no production code imports this. An in-memory Google with the OAuth
// endpoints and the parts of Calendar API v3 that Care Hub uses, behind `fetch`, so tests run
// the real HTTP code. The client ID, the secret and all tokens are made up at run time.
import { createHash, randomBytes } from 'node:crypto';
import type { FetchLike } from './http';

export interface MockHttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface MockHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface LoggedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
}
/** Makes the next matching request(s) fail. `path` matches part of the URL path. */
export type MockFailure = { times?: number; path?: string } & (
  { status: number; reason?: string; retryAfter?: string; body?: unknown } | { network: true }
);
type Json = Record<string, unknown>;

const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers: { 'content-type': 'application/json; charset=UTF-8', ...headers },
  body: JSON.stringify(body),
});
/** Google's JSON error shape. */
export const googleErrorBody = (status: number, reason: string, message = reason) => ({
  error: { code: status, message, errors: [{ domain: 'global', reason, message }] },
});

interface Grant {
  scopes: string[];
  revoked: boolean;
}

export function createMockGoogle(
  options: { account?: string; timeZone?: string; now?: string; maxPageSize?: number } = {},
) {
  const account = options.account ?? 'avery.lin@example.com';
  let clock = Date.parse(options.now ?? '2026-10-27T13:00:00Z');
  const settings = {
    GOOGLE_CLIENT_ID: `carehub-test-${randomBytes(6).toString('hex')}.apps.example.com`,
    GOOGLE_CLIENT_SECRET: token(),
  };
  const requests: LoggedRequest[] = [];
  const failures: (MockFailure & { left: number })[] = [];
  const grants: Grant[] = [];
  const codes = new Map<
    string,
    {
      grant: Grant;
      offline: boolean;
      redirectUri: string;
      challenge: string;
      method: string;
      expiresAt: number;
    }
  >();
  const refreshTokens = new Map<string, Grant>();
  const accessTokens = new Map<string, { grant: Grant; expiresAt: number }>();

  function issueTokens(grant: Grant, withRefreshToken: boolean): Json {
    const accessToken = `mock-access-${token()}`;
    accessTokens.set(accessToken, { grant, expiresAt: clock + 3_599_000 });
    const body: Json = {
      access_token: accessToken,
      expires_in: 3599,
      scope: grant.scopes.join(' '),
      token_type: 'Bearer',
    };
    if (withRefreshToken) {
      const refreshToken = `mock-refresh-${token()}`;
      refreshTokens.set(refreshToken, grant);
      body.refresh_token = refreshToken;
    }
    return body;
  }

  /** The person's choice on Google's consent screen. Returns the callback's query. */
  function consent(
    authorizationUrl: string,
    choice: { deny?: boolean; grant?: string[]; withholdRefreshToken?: boolean } = {},
  ): { code?: string; state?: string; error?: string } {
    const url = new URL(authorizationUrl);
    const params = url.searchParams;
    if (`${url.origin}${url.pathname}` !== 'https://accounts.google.com/o/oauth2/v2/auth') {
      throw new Error('Not the Google sign-in page');
    }
    if (params.get('client_id') !== settings.GOOGLE_CLIENT_ID) throw new Error('Unknown client');
    const state = params.get('state') ?? undefined;
    if (choice.deny) return { error: 'access_denied', state };
    const grant = {
      scopes: choice.grant ?? (params.get('scope') ?? '').split(' '),
      revoked: false,
    };
    grants.push(grant);
    const code = `mock-code-${token()}`;
    codes.set(code, {
      grant,
      offline: params.get('access_type') === 'offline' && !choice.withholdRefreshToken,
      redirectUri: params.get('redirect_uri') ?? '',
      challenge: params.get('code_challenge') ?? '',
      method: params.get('code_challenge_method') ?? 'plain',
      expiresAt: clock + 600_000,
    });
    return { code, state };
  }

  function tokenEndpoint(form: URLSearchParams): MockHttpResponse {
    if (
      form.get('client_id') !== settings.GOOGLE_CLIENT_ID ||
      form.get('client_secret') !== settings.GOOGLE_CLIENT_SECRET
    ) {
      return json(401, { error: 'invalid_client', error_description: 'Unauthorized' });
    }
    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') {
      const code = form.get('code') ?? '';
      const entry = codes.get(code);
      codes.delete(code); // a code works once
      if (!entry || entry.expiresAt < clock) {
        return json(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' });
      }
      if (form.get('redirect_uri') !== entry.redirectUri) {
        return json(400, { error: 'redirect_uri_mismatch', error_description: 'Bad Request' });
      }
      const verifier = form.get('code_verifier') ?? '';
      const challenge =
        entry.method === 'S256'
          ? createHash('sha256').update(verifier).digest('base64url')
          : verifier;
      if (!entry.challenge || challenge !== entry.challenge) {
        return json(400, { error: 'invalid_grant', error_description: 'Invalid code verifier.' });
      }
      return json(200, issueTokens(entry.grant, entry.offline));
    }
    if (grantType === 'refresh_token') {
      const grant = refreshTokens.get(form.get('refresh_token') ?? '');
      if (!grant || grant.revoked) {
        return json(400, {
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        });
      }
      return json(200, issueTokens(grant, false));
    }
    return json(400, { error: 'unsupported_grant_type', error_description: 'Invalid grant_type' });
  }

  function revokeEndpoint(form: URLSearchParams): MockHttpResponse {
    const value = form.get('token') ?? '';
    const grant = refreshTokens.get(value) ?? accessTokens.get(value)?.grant;
    if (!grant || grant.revoked) {
      return json(400, { error: 'invalid_token', error_description: 'Token expired or revoked' });
    }
    grant.revoked = true;
    return json(200, {});
  }

  function handle(request: MockHttpRequest): MockHttpResponse {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers ?? {}))
      headers[name.toLowerCase()] = value;
    const body = request.body ?? '';
    requests.push({ method: request.method, url, headers, body });
    const failure = failures.find((f) => f.left > 0 && (!f.path || url.pathname.includes(f.path)));
    if (failure) {
      failure.left -= 1;
      if ('network' in failure) throw new TypeError('fetch failed');
      const reply =
        failure.body ?? googleErrorBody(failure.status, failure.reason ?? 'backendError');
      return json(
        failure.status,
        reply,
        failure.retryAfter ? { 'retry-after': failure.retryAfter } : {},
      );
    }
    if (url.origin === 'https://oauth2.googleapis.com' && request.method === 'POST') {
      if (url.pathname === '/token') return tokenEndpoint(new URLSearchParams(body));
      if (url.pathname === '/revoke') return revokeEndpoint(new URLSearchParams(body));
    }
    return json(404, { error: 'not_found' });
  }

  const fetch: FetchLike = async (url, init = {}) => {
    init.signal?.throwIfAborted();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const body = typeof init.body === 'string' ? init.body : '';
    const reply = handle({ method: init.method ?? 'GET', url, headers, body });
    const empty = [101, 204, 205, 304].includes(reply.status);
    return new Response(empty ? null : reply.body, {
      status: reply.status,
      headers: reply.headers,
    });
  };

  return {
    /** Made-up client credentials, as `readSettings` would return them. */
    settings,
    account,
    fetch,
    /** The same, synchronously, for code that can't wait (the Apps Script stand-in). */
    handle,
    requests,
    now: () => new Date(clock),
    advance(ms: number) {
      clock += ms;
    },
    fail(failure: MockFailure) {
      failures.push({ ...failure, left: failure.times ?? 1 });
    },
    consent,
    /** The person removes Care Hub from their Google Account. */
    revokeAccess() {
      for (const grant of grants) grant.revoked = true;
    },
    activeGrants: () => grants.filter((grant) => !grant.revoked).length,
  };
}
export type MockGoogle = ReturnType<typeof createMockGoogle>;
