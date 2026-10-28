// Signing a person in to a provider: authorization code with PKCE (S256). The state and the
// verifier stay on the server (service.ts); the provider only sees the challenge.
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ProviderError, readJson, send, type Fetch } from './http';
import type { OAuthConfig, TokenSet } from './types';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** SHA-256 in base64url: the PKCE challenge, and how states and sessions are kept. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

/** A new sign-in: `state` goes to the provider and comes back; `verifier` stays on the server. */
export function newSignIn(): { state: string; verifier: string } {
  return {
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
  };
}

/** The provider's consent page for this sign-in. */
export function authorizeUrl(
  config: OAuthConfig,
  client: OAuthClient,
  state: string,
  verifier: string,
): string {
  const url = new URL(config.authorizeUrl);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    ...(config.scopes.length > 0 ? { scope: config.scopes.join(' ') } : {}),
    state,
    code_challenge: sha256(verifier),
    code_challenge_method: 'S256',
    ...config.authorizeParams,
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

// As RFC 6749 asks: form-encoded before Basic, or as form fields.
const formEncoded = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');

function withClient(config: OAuthConfig, client: OAuthClient, fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (config.clientAuth === 'basic') {
    const pair = `${formEncoded(client.clientId)}:${formEncoded(client.clientSecret)}`;
    headers.authorization = `Basic ${Buffer.from(pair).toString('base64')}`;
  } else {
    body.set('client_id', client.clientId);
    body.set('client_secret', client.clientSecret);
  }
  return { method: 'POST', headers, body };
}

const tokenAnswer = z.object({
  access_token: z.string().min(1).max(20_000),
  refresh_token: z.string().min(1).max(20_000).optional(),
  expires_in: z.coerce.number().positive().max(31_536_000).optional(),
});

function tokenError(status: number, answer: unknown): ProviderError {
  const code = z.object({ error: z.string() }).safeParse(answer).data?.error;
  if (status === 429 || status >= 500) return new ProviderError('temporary', status);
  if (status === 401 || code === 'invalid_client' || code === 'unauthorized_client') {
    return new ProviderError('client-rejected', status);
  }
  if (code === 'invalid_grant') return new ProviderError('reconnect', status);
  return new ProviderError('failed', status);
}

async function requestTokens(
  fetcher: Fetch,
  config: OAuthConfig,
  client: OAuthClient,
  fields: Record<string, string>,
  now: number,
): Promise<TokenSet> {
  const response = await send(fetcher, config.tokenUrl, withClient(config, client, fields));
  const answer = await readJson(response);
  if (!response.ok) throw tokenError(response.status, answer);
  const tokens = tokenAnswer.safeParse(answer);
  if (!tokens.success) throw new ProviderError('failed', response.status);
  const { access_token: accessToken, refresh_token: refreshToken, expires_in } = tokens.data;
  return {
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAt: now + (expires_in ?? 3600) * 1000,
  };
}

/** The tokens for the code the callback got, with this sign-in's verifier. */
export function exchangeCode(
  fetcher: Fetch,
  config: OAuthConfig,
  client: OAuthClient,
  code: string,
  verifier: string,
  now: number,
): Promise<TokenSet> {
  const fields = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: client.redirectUri,
    code_verifier: verifier,
  };
  return requestTokens(fetcher, config, client, fields, now);
}

/**
 * New tokens from the refresh token. Zoom sends a new refresh token every time and the old one
 * stops working; others may keep the old one. A refusal that isn't about the client means the
 * person has to connect again.
 */
export async function refreshTokens(
  fetcher: Fetch,
  config: OAuthConfig,
  client: OAuthClient,
  refreshToken: string,
  now: number,
): Promise<TokenSet> {
  const fields = { grant_type: 'refresh_token', refresh_token: refreshToken };
  try {
    const tokens = await requestTokens(fetcher, config, client, fields, now);
    return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'failed' && (error.status ?? 0) >= 400) {
      throw new ProviderError('reconnect', error.status);
    }
    throw error;
  }
}

/** Withdraws the sign-in at the provider, when it has a way (on disconnect). Best effort. */
export async function revokeToken(
  fetcher: Fetch,
  config: OAuthConfig,
  client: OAuthClient,
  token: string,
): Promise<void> {
  if (!config.revokeUrl) return;
  try {
    const response = await send(fetcher, config.revokeUrl, withClient(config, client, { token }));
    await response.body?.cancel();
  } catch {
    // The tokens are deleted on this side either way.
  }
}
