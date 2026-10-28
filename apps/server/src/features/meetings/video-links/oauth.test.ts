import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderError } from './http';
import { authorizeUrl, exchangeCode, newSignIn, refreshTokens, revokeToken, sha256 } from './oauth';
import { startFakeZoom, type FakeZoom } from './testing';
import type { OAuthConfig } from './types';
import { zoomProvider } from './zoom';

const NOW = Date.parse('2026-10-28T15:00:00Z');

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ProviderError)) throw new Error('Expected a ProviderError.');
  return error;
}

describe('PKCE sign-in', () => {
  it("makes RFC 7636's S256 challenge", () => {
    expect(sha256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('sends the challenge, never the verifier or the secret', () => {
    const { state, verifier } = newSignIn();
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(verifier).toMatch(/^[\w-]{43}$/);
    const config: OAuthConfig = {
      authorizeUrl: 'https://login.example.com/authorize',
      tokenUrl: 'https://login.example.com/token',
      scopes: ['meetings.write', 'offline_access'],
      clientAuth: 'body',
      authorizeParams: { prompt: 'select_account' },
    };
    const client = {
      clientId: 'client-example',
      clientSecret: 'secret-example',
      redirectUri: 'https://carehub.example.com/api/meetings/video-links/teams/callback',
    };
    const url = new URL(authorizeUrl(config, client, state, verifier));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-example',
      redirect_uri: client.redirectUri,
      scope: 'meetings.write offline_access',
      state,
      code_challenge: sha256(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    expect(url.toString()).not.toContain(verifier);
    expect(url.toString()).not.toContain('secret-example');
  });
});

describe('tokens', () => {
  let zoom: FakeZoom;
  let client: { clientId: string; clientSecret: string; redirectUri: string };
  let config: OAuthConfig;

  beforeAll(async () => {
    zoom = await startFakeZoom();
    config = zoomProvider(zoom.urls).oauth;
    client = {
      clientId: zoom.clientId,
      clientSecret: zoom.clientSecret,
      redirectUri: 'https://carehub.example.com/api/meetings/video-links/zoom/callback',
    };
  });
  afterAll(() => zoom.close());

  const signIn = () => {
    const { state, verifier } = newSignIn();
    const code = zoom.approve(authorizeUrl(config, client, state, verifier));
    return { code, verifier };
  };

  it('trades the code and the verifier for tokens, with the secret in Basic only', async () => {
    const { code, verifier } = signIn();
    const tokens = await exchangeCode(fetch, config, client, code, verifier, NOW);
    expect(tokens.accessToken).toMatch(/^zat-/);
    expect(tokens.refreshToken).toMatch(/^zrt-/);
    expect(tokens.expiresAt).toBe(NOW + 3599 * 1000);
    const request = zoom.requests.at(-1);
    expect(request?.authorization).toMatch(/^Basic /);
    const form = new URLSearchParams(request?.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code_verifier')).toBe(verifier);
    expect(form.get('redirect_uri')).toBe(client.redirectUri);
    expect(request?.body).not.toContain(zoom.clientSecret);
  });

  it('refuses a code with another verifier, or a wrong secret', async () => {
    const { code } = signIn();
    const wrong = newSignIn().verifier;
    expect((await failure(exchangeCode(fetch, config, client, code, wrong, NOW))).kind).toBe(
      'failed',
    );
    const other = { ...client, clientSecret: 'not-the-secret' };
    const { code: next, verifier } = signIn();
    const refused = await failure(exchangeCode(fetch, config, other, next, verifier, NOW));
    expect(refused.kind).toBe('client-rejected');
  });

  it('keeps the new refresh token, since the old one works once', async () => {
    const { code, verifier } = signIn();
    const first = await exchangeCode(fetch, config, client, code, verifier, NOW);
    const second = await refreshTokens(fetch, config, client, first.refreshToken ?? '', NOW);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).not.toBe(first.accessToken);
    const again = await failure(
      refreshTokens(fetch, config, client, first.refreshToken ?? '', NOW),
    );
    expect(again.kind).toBe('reconnect');
  });

  it('calls busy answers, cut-offs and oversized answers what they are', async () => {
    zoom.fail('/oauth/token', 503);
    expect((await failure(refreshTokens(fetch, config, client, 'zrt-x', NOW))).kind).toBe(
      'temporary',
    );
    zoom.fail('/oauth/token', 200, { access_token: 'x'.repeat(300_000) });
    expect((await failure(refreshTokens(fetch, config, client, 'zrt-x', NOW))).kind).toBe('failed');
    zoom.fail('/oauth/token', 200, { token_type: 'bearer' });
    expect((await failure(refreshTokens(fetch, config, client, 'zrt-x', NOW))).kind).toBe('failed');
    const nowhere = { ...config, tokenUrl: 'http://127.0.0.1:9/oauth/token' };
    expect((await failure(refreshTokens(fetch, nowhere, client, 'zrt-x', NOW))).kind).toBe(
      'temporary',
    );
  });

  it('sends the client in form fields when the provider wants them there', async () => {
    let sent: RequestInit | undefined;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = init;
      return new Response(JSON.stringify({ access_token: 'access-example' }), { status: 200 });
    }) as typeof fetch;
    const body = { ...config, clientAuth: 'body' as const };
    const tokens = await refreshTokens(fetcher, body, client, 'refresh-example', NOW);
    expect(tokens).toEqual({
      accessToken: 'access-example',
      refreshToken: 'refresh-example',
      expiresAt: NOW + 3600 * 1000,
    });
    const form = new URLSearchParams(sent?.body as URLSearchParams);
    expect(form.get('client_secret')).toBe(zoom.clientSecret);
    expect((sent?.headers as Record<string, string>).authorization).toBeUndefined();
    expect(sent?.redirect).toBe('error');
  });

  it('withdraws the sign-in on disconnect, quietly when the provider fails', async () => {
    const { code, verifier } = signIn();
    const tokens = await exchangeCode(fetch, config, client, code, verifier, NOW);
    await revokeToken(fetch, config, client, tokens.accessToken);
    expect(zoom.accessTokens.has(tokens.accessToken)).toBe(false);
    zoom.fail('/oauth/revoke', 500);
    await revokeToken(fetch, config, client, tokens.accessToken);
    await revokeToken(fetch, { ...config, revokeUrl: undefined }, client, 'zat-x');
  });
});
