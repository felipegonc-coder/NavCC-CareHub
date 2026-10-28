import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMockGoogle, type MockGoogle } from './mock-google';
import {
  GOOGLE_SCOPES,
  type GoogleOAuth,
  createGoogleOAuth,
  googleRedirectUri,
  googleSettingsSchema,
  tokensNeedRefresh,
} from './oauth';

const REDIRECT = googleRedirectUri('https://carehub.example.org/');
const READ_ALL = 'https://www.googleapis.com/auth/calendar.readonly';

function setup() {
  const google = createMockGoogle();
  const oauth = createGoogleOAuth(google.settings, { fetch: google.fetch, now: google.now });
  return { google, oauth };
}

async function signIn(
  google: MockGoogle,
  oauth: GoogleOAuth,
  choice?: Parameters<MockGoogle['consent']>[1],
) {
  const request = oauth.createAuthorizationRequest({ redirectUri: REDIRECT });
  if (request.kind !== 'ready') throw new Error(request.message);
  const callback = google.consent(request.url, choice);
  return oauth.exchangeCode({
    callback,
    expectedState: request.state,
    codeVerifier: request.codeVerifier,
    redirectUri: REDIRECT,
  });
}

async function connectedTokens(google: MockGoogle, oauth: GoogleOAuth) {
  const outcome = await signIn(google, oauth);
  if (outcome.kind !== 'connected') throw new Error(outcome.message);
  return outcome.tokens;
}

const tokenRequests = (google: MockGoogle) =>
  google.requests.filter((request) => request.url.pathname === '/token');

describe('Google sign-in settings', () => {
  it('treats missing or empty settings as not set up, without calling Google', async () => {
    const google = createMockGoogle();
    for (const raw of [{}, { GOOGLE_CLIENT_ID: '  ', GOOGLE_CLIENT_SECRET: '' }]) {
      const settings = googleSettingsSchema.parse(raw);
      expect(settings).toEqual({});
      const oauth = createGoogleOAuth(settings, { fetch: google.fetch });
      expect(oauth.configured).toBe(false);
      const notSetUp = {
        kind: 'not-configured',
        reason: 'missing-settings',
        message: "Google sign-in isn't set up yet.",
      };
      expect(oauth.createAuthorizationRequest({ redirectUri: REDIRECT })).toEqual(notSetUp);
      expect(await oauth.refresh('anything')).toEqual(notSetUp);
      const callback = { code: 'some-code', state: 'state' };
      const exchange = {
        callback,
        expectedState: 'state',
        codeVerifier: 'v',
        redirectUri: REDIRECT,
      };
      expect(await oauth.exchangeCode(exchange)).toEqual(notSetUp);
    }
    expect(google.requests).toHaveLength(0);
  });

  it('builds the redirect URL from the public URL', () => {
    expect(REDIRECT).toBe('https://carehub.example.org/api/calendar/google/callback');
    expect(googleRedirectUri('https://carehub.example.org')).toBe(REDIRECT);
    expect(googleRedirectUri('https://example.net/care//')).toBe(
      'https://example.net/care/api/calendar/google/callback',
    );
  });
});

describe('Google sign-in', () => {
  it('sends the person to Google with PKCE, offline access and both scopes', () => {
    const { google, oauth } = setup();
    const request = oauth.createAuthorizationRequest({
      redirectUri: REDIRECT,
      loginHint: 'avery.lin@example.com',
    });
    if (request.kind !== 'ready') throw new Error('not ready');
    const url = new URL(request.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: google.settings.GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: request.state,
      code_challenge: createHash('sha256').update(request.codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
      login_hint: 'avery.lin@example.com',
    });
    expect(request.url).not.toContain(google.settings.GOOGLE_CLIENT_SECRET);
    expect(request.state).toMatch(/^[\w-]{43}$/);
    expect(request.codeVerifier).toMatch(/^[\w-]{43}$/);
    const again = oauth.createAuthorizationRequest({ redirectUri: REDIRECT });
    if (again.kind !== 'ready') throw new Error('not ready');
    expect(again.state).not.toBe(request.state);
    expect(again.codeVerifier).not.toBe(request.codeVerifier);
  });

  it('connects and returns tokens, sending the secret only in the token request body', async () => {
    const { google, oauth } = setup();
    const outcome = await signIn(google, oauth);
    expect(outcome.kind).toBe('connected');
    if (outcome.kind !== 'connected') return;
    expect(outcome.tokens.scopes).toEqual([...GOOGLE_SCOPES]);
    expect(outcome.tokens.refreshToken).toMatch(/^mock-refresh-/);
    expect(outcome.tokens.accessToken).toMatch(/^mock-access-/);
    expect(outcome.tokens.expiresAt).toBe(
      new Date(google.now().getTime() + 3_599_000).toISOString(),
    );
    const [exchange] = tokenRequests(google);
    const form = new URLSearchParams(exchange?.body);
    expect(form.get('client_secret')).toBe(google.settings.GOOGLE_CLIENT_SECRET);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('redirect_uri')).toBe(REDIRECT);
    expect(exchange?.url.search).toBe('');
    expect(JSON.stringify(outcome)).not.toContain(google.settings.GOOGLE_CLIENT_SECRET);
  });

  it('turns down a callback whose state does not match, before calling Google', async () => {
    const { google, oauth } = setup();
    const request = oauth.createAuthorizationRequest({ redirectUri: REDIRECT });
    if (request.kind !== 'ready') throw new Error('not ready');
    const callback = google.consent(request.url);
    const base = { codeVerifier: request.codeVerifier, redirectUri: REDIRECT };
    for (const state of [`${request.state.slice(0, -1)}x`, '', undefined, null]) {
      const outcome = await oauth.exchangeCode({
        ...base,
        callback: { ...callback, state },
        expectedState: request.state,
      });
      expect(outcome).toMatchObject({ kind: 'needs-reconnect', reason: 'state-mismatch' });
    }
    expect(tokenRequests(google)).toHaveLength(0);
  });

  it('reports a cancelled or failed sign-in', async () => {
    const { google, oauth } = setup();
    expect(await signIn(google, oauth, { deny: true })).toMatchObject({
      kind: 'needs-reconnect',
      reason: 'cancelled',
      message: 'Google sign-in was cancelled.',
    });
    const request = oauth.createAuthorizationRequest({ redirectUri: REDIRECT });
    if (request.kind !== 'ready') throw new Error('not ready');
    const outcome = await oauth.exchangeCode({
      callback: { error: 'server_error', state: request.state },
      expectedState: request.state,
      codeVerifier: request.codeVerifier,
      redirectUri: REDIRECT,
    });
    expect(outcome).toMatchObject({ kind: 'needs-reconnect', reason: 'sign-in-failed' });
    expect(tokenRequests(google)).toHaveLength(0);
  });

  it('does not accept a code with the wrong verifier, or the same code twice', async () => {
    const { google, oauth } = setup();
    const request = oauth.createAuthorizationRequest({ redirectUri: REDIRECT });
    if (request.kind !== 'ready') throw new Error('not ready');
    const callback = google.consent(request.url);
    const exchange = { callback, expectedState: request.state, redirectUri: REDIRECT };
    const wrong = await oauth.exchangeCode({
      ...exchange,
      codeVerifier: `${request.codeVerifier}x`,
    });
    expect(wrong).toMatchObject({ kind: 'needs-reconnect', reason: 'invalid-grant' });
    const reused = await oauth.exchangeCode({ ...exchange, codeVerifier: request.codeVerifier });
    expect(reused).toMatchObject({ kind: 'needs-reconnect', reason: 'invalid-grant' });
  });

  it('asks to connect again when calendar access was not allowed, and lets go of the grant', async () => {
    const { google, oauth } = setup();
    const outcome = await signIn(google, oauth, { grant: [GOOGLE_SCOPES[0]] });
    expect(outcome).toMatchObject({
      kind: 'needs-reconnect',
      reason: 'missing-scopes',
      missingScopes: [GOOGLE_SCOPES[1]],
    });
    expect(JSON.stringify(outcome)).not.toContain('mock-refresh-');
    expect(google.requests.some((request) => request.url.pathname === '/revoke')).toBe(true);
    expect(google.activeGrants()).toBe(0);
  });

  it('accepts a broader read-only scope in place of the narrower ones', async () => {
    const { google, oauth } = setup();
    expect(await signIn(google, oauth, { grant: [READ_ALL] })).toMatchObject({
      kind: 'connected',
      tokens: { scopes: [READ_ALL] },
    });
  });

  it('asks to connect again when Google keeps no refresh token, and lets go of the grant', async () => {
    const { google, oauth } = setup();
    const outcome = await signIn(google, oauth, { withholdRefreshToken: true });
    expect(outcome).toMatchObject({ kind: 'needs-reconnect', reason: 'no-refresh-token' });
    expect(google.activeGrants()).toBe(0);
  });
});

describe('Google tokens', () => {
  it('refreshes the access token and keeps the refresh token', async () => {
    const { google, oauth } = setup();
    const tokens = await connectedTokens(google, oauth);
    expect(tokensNeedRefresh(tokens, google.now())).toBe(false);
    google.advance(3_560_000);
    expect(tokensNeedRefresh(tokens, google.now())).toBe(true);
    const refreshed = await oauth.refresh(tokens.refreshToken);
    expect(refreshed.kind).toBe('connected');
    if (refreshed.kind !== 'connected') return;
    expect(refreshed.tokens.refreshToken).toBe(tokens.refreshToken);
    expect(refreshed.tokens.accessToken).not.toBe(tokens.accessToken);
    expect(tokensNeedRefresh(refreshed.tokens, google.now())).toBe(false);
  });

  it('asks to connect again after access is removed in Google', async () => {
    const { google, oauth } = setup();
    const tokens = await connectedTokens(google, oauth);
    google.revokeAccess();
    expect(await oauth.refresh(tokens.refreshToken)).toEqual({
      kind: 'needs-reconnect',
      reason: 'revoked',
      message: 'Google needs you to sign in again.',
    });
  });

  it('reports a wrong client secret as a setup problem, without repeating it', async () => {
    const { google, oauth } = setup();
    const tokens = await connectedTokens(google, oauth);
    const wrongSecret = `${google.settings.GOOGLE_CLIENT_SECRET}-old`;
    const misconfigured = createGoogleOAuth(
      { ...google.settings, GOOGLE_CLIENT_SECRET: wrongSecret },
      { fetch: google.fetch },
    );
    const outcome = await misconfigured.refresh(tokens.refreshToken);
    expect(outcome).toMatchObject({ kind: 'not-configured', reason: 'client-rejected' });
    expect(JSON.stringify(outcome)).not.toContain(wrongSecret);
    expect(JSON.stringify(outcome)).not.toContain(tokens.refreshToken);
  });

  it('treats outages, rate limits, network failures and odd answers as temporary', async () => {
    const { google, oauth } = setup();
    const tokens = await connectedTokens(google, oauth);
    google.fail({ status: 503, path: '/token' });
    expect(await oauth.refresh(tokens.refreshToken)).toMatchObject({
      kind: 'temporary-error',
      reason: 'unavailable',
    });
    google.fail({ status: 429, retryAfter: '30', path: '/token' });
    expect(await oauth.refresh(tokens.refreshToken)).toMatchObject({
      kind: 'temporary-error',
      reason: 'rate-limited',
      retryAfterMs: 30_000,
    });
    google.fail({ network: true, path: '/token' });
    expect(await oauth.refresh(tokens.refreshToken)).toMatchObject({
      kind: 'temporary-error',
      reason: 'network',
    });
    const odd = createGoogleOAuth(google.settings, {
      fetch: async () => new Response('<html>Sorry</html>', { status: 200 }),
    });
    expect(await odd.refresh(tokens.refreshToken)).toMatchObject({
      kind: 'temporary-error',
      reason: 'unexpected-response',
    });
    expect((await oauth.refresh(tokens.refreshToken)).kind).toBe('connected');
  });

  it('gives up on slow or oversized answers from Google, for refresh and revoke alike', async () => {
    const { google, oauth } = setup();
    const tokens = await connectedTokens(google, oauth);
    const signals: unknown[] = [];
    const hanging = createGoogleOAuth(google.settings, {
      timeoutMs: 20,
      fetch: (_url, init) => {
        signals.push(init?.signal);
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      },
    });
    expect(await hanging.refresh(tokens.refreshToken)).toMatchObject({
      kind: 'temporary-error',
      reason: 'timeout',
      message: "Google didn't answer in time. Care Hub will try again shortly.",
    });
    expect(await hanging.revoke(tokens.refreshToken)).toMatchObject({ reason: 'timeout' });
    expect(signals).toHaveLength(2);
    const huge = createGoogleOAuth(google.settings, {
      fetch: async () => new Response(`{"access_token":"${'x'.repeat(1024 * 1024)}"}`),
    });
    expect(await huge.refresh(tokens.refreshToken)).toMatchObject({
      kind: 'temporary-error',
      reason: 'unexpected-response',
    });
    const watched: unknown[] = [];
    const timed = createGoogleOAuth(google.settings, {
      fetch: (url, init) => {
        watched.push(init?.signal);
        return google.fetch(url, init);
      },
    });
    expect((await timed.refresh(tokens.refreshToken)).kind).toBe('connected');
    expect(watched[0]).toBeInstanceOf(AbortSignal);
  });

  it('revokes, treats an already revoked token as done, and needs no settings to do it', async () => {
    const { google, oauth } = setup();
    const tokens = await connectedTokens(google, oauth);
    expect(await oauth.revoke(tokens.refreshToken)).toEqual({ kind: 'revoked' });
    expect(google.activeGrants()).toBe(0);
    expect(await oauth.refresh(tokens.refreshToken)).toMatchObject({ reason: 'revoked' });
    expect(await oauth.revoke(tokens.refreshToken)).toEqual({ kind: 'revoked' });
    const unconfigured = createGoogleOAuth({}, { fetch: google.fetch });
    expect(await unconfigured.revoke(tokens.accessToken)).toEqual({ kind: 'revoked' });
    google.fail({ status: 503, path: '/revoke' });
    expect(await oauth.revoke(tokens.accessToken)).toMatchObject({ reason: 'unavailable' });
  });

  it('refreshes early, and when the expiry is unreadable', () => {
    const now = new Date('2026-10-27T13:00:00Z');
    expect(tokensNeedRefresh({ expiresAt: '2026-10-27T13:00:59Z' }, now)).toBe(true);
    expect(tokensNeedRefresh({ expiresAt: '2026-10-27T13:01:01Z' }, now)).toBe(false);
    expect(tokensNeedRefresh({ expiresAt: '2026-10-27T13:05:00Z' }, now, 600_000)).toBe(true);
    expect(tokensNeedRefresh({ expiresAt: 'soon' }, now)).toBe(true);
  });
});
