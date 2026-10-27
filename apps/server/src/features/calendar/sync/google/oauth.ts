// Google sign-in for the calendar connection (CA-07): the OAuth 2.0 authorization code flow
// with PKCE, token refresh and revoke, over plain fetch. The caller keeps `state` and
// `codeVerifier` between the redirect and the callback, and stores the tokens encrypted.
// Nothing here logs, and outcomes never carry the client secret, the code or a token
// (only `tokens` on a successful connection).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { type FetchLike, parseRetryAfter, readJson } from './http';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const SCOPE = 'https://www.googleapis.com/auth/';
/** See the calendar list, and see and edit events. The primary calendar's id is the account email. */
export const GOOGLE_SCOPES = [
  `${SCOPE}calendar.calendarlist.readonly`,
  `${SCOPE}calendar.events`,
] as const;
/** Broader scopes a person may already have granted that cover what Care Hub asks for. */
const COVERED_BY: Record<string, string[]> = {
  [GOOGLE_SCOPES[0]]: [
    `${SCOPE}calendar`,
    `${SCOPE}calendar.readonly`,
    `${SCOPE}calendar.calendarlist`,
  ],
  [GOOGLE_SCOPES[1]]: [`${SCOPE}calendar`],
};

export const GOOGLE_SIGN_IN_MESSAGES = {
  'missing-settings': "Google sign-in isn't set up yet.",
  'client-rejected':
    "Google didn't accept Care Hub's sign-in settings. Check the Google client ID, secret and redirect URL.",
  'state-mismatch': 'That sign-in link has expired. Please try connecting again.',
  cancelled: 'Google sign-in was cancelled.',
  'sign-in-failed': "Google sign-in didn't finish. Please try again.",
  'missing-scopes':
    'Care Hub needs to see your calendars and edit events. Please connect again and allow both.',
  'no-refresh-token': "Google didn't keep Care Hub signed in. Please connect again.",
  revoked: 'Google needs you to sign in again.',
  'invalid-grant': 'Google needs you to sign in again.',
  network: "Couldn't reach Google. Care Hub will try again shortly.",
  unavailable: "Google isn't answering right now. Care Hub will try again shortly.",
  'rate-limited': 'Google asked Care Hub to slow down. Care Hub will try again shortly.',
  'unexpected-response': "Google sent an answer Care Hub didn't understand. Please try again.",
} as const;

const setting = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);
/** For `readSettings` (core/settings.ts). Empty values count as not set. */
export const googleSettingsSchema = z.object({
  GOOGLE_CLIENT_ID: setting,
  GOOGLE_CLIENT_SECRET: setting,
});
export interface GoogleSettings {
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO instant when the access token stops working. */
  expiresAt: string;
  scopes: string[];
  /** Set when Google limits how long the sign-in lasts (for example, a client still in testing). */
  refreshTokenExpiresAt?: string;
}
export interface NotConfigured {
  kind: 'not-configured';
  reason: 'missing-settings' | 'client-rejected';
  message: string;
}
export interface NeedsReconnect {
  kind: 'needs-reconnect';
  reason:
    | 'state-mismatch'
    | 'cancelled'
    | 'sign-in-failed'
    | 'missing-scopes'
    | 'no-refresh-token'
    | 'revoked'
    | 'invalid-grant';
  message: string;
  missingScopes?: string[];
}
export interface TemporaryError {
  kind: 'temporary-error';
  reason: 'network' | 'unavailable' | 'rate-limited' | 'unexpected-response';
  message: string;
  retryAfterMs?: number;
}
export type TokenOutcome =
  { kind: 'connected'; tokens: GoogleTokens } | NotConfigured | NeedsReconnect | TemporaryError;
export interface AuthorizationRequest {
  kind: 'ready';
  /** Send the person here. */
  url: string;
  /** Keep both until the callback, tied to the person's session. */
  state: string;
  codeVerifier: string;
}
export interface CallbackQuery {
  code?: string | null;
  state?: string | null;
  error?: string | null;
}

const notConfigured = (reason: NotConfigured['reason']): NotConfigured => ({
  kind: 'not-configured',
  reason,
  message: GOOGLE_SIGN_IN_MESSAGES[reason],
});
const reconnect = (reason: NeedsReconnect['reason'], missingScopes?: string[]): NeedsReconnect => ({
  kind: 'needs-reconnect',
  reason,
  message: GOOGLE_SIGN_IN_MESSAGES[reason],
  ...(missingScopes ? { missingScopes } : {}),
});
const temporary = (reason: TemporaryError['reason'], retryAfterMs?: number): TemporaryError => ({
  kind: 'temporary-error',
  reason,
  message: GOOGLE_SIGN_IN_MESSAGES[reason],
  ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
});

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().positive().optional(),
  scope: z.string().optional(),
});
const tokenErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() });
const CLIENT_ERRORS = ['invalid_client', 'unauthorized_client', 'redirect_uri_mismatch'];

export interface GoogleOAuthOptions {
  fetch: FetchLike;
  now?: () => Date;
}

export function createGoogleOAuth(settings: GoogleSettings, options: GoogleOAuthOptions) {
  const clientId = settings.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = settings.GOOGLE_CLIENT_SECRET?.trim();
  const client = clientId && clientSecret ? { clientId, clientSecret } : undefined;
  const now = options.now ?? (() => new Date());

  const post = (url: string, form: Record<string, string>) =>
    options.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    });

  type Issued = Omit<GoogleTokens, 'refreshToken'> & { refreshToken?: string };
  async function requestTokens(
    form: Record<string, string>,
  ): Promise<{ kind: 'issued'; tokens: Issued } | Exclude<TokenOutcome, { kind: 'connected' }>> {
    if (!client) return notConfigured('missing-settings');
    let response: Response;
    let body: unknown;
    try {
      response = await post(GOOGLE_TOKEN_URL, {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        ...form,
      });
      body = await readJson(response);
    } catch {
      return temporary('network');
    }
    if (response.ok) {
      const parsed = tokenSchema.safeParse(body);
      if (!parsed.success) return temporary('unexpected-response');
      const issued = parsed.data;
      const at = now().getTime();
      const tokens: Issued = {
        accessToken: issued.access_token,
        expiresAt: new Date(at + issued.expires_in * 1000).toISOString(),
        // Google always lists the granted scopes; if it ever doesn't, the first call will tell.
        scopes: issued.scope?.split(' ').filter(Boolean) ?? [...GOOGLE_SCOPES],
      };
      if (issued.refresh_token) tokens.refreshToken = issued.refresh_token;
      if (issued.refresh_token_expires_in) {
        tokens.refreshTokenExpiresAt = new Date(
          at + issued.refresh_token_expires_in * 1000,
        ).toISOString();
      }
      return { kind: 'issued', tokens };
    }
    if (response.status === 429) {
      return temporary(
        'rate-limited',
        parseRetryAfter(response.headers.get('retry-after'), now().getTime()),
      );
    }
    if (response.status >= 500) return temporary('unavailable');
    const problem = tokenErrorSchema.safeParse(body);
    if (!problem.success) return reconnect('sign-in-failed');
    if (CLIENT_ERRORS.includes(problem.data.error)) return notConfigured('client-rejected');
    if (problem.data.error === 'invalid_grant') {
      return reconnect(
        /revoked/i.test(problem.data.error_description ?? '') ? 'revoked' : 'invalid-grant',
      );
    }
    return reconnect('sign-in-failed');
  }

  function createAuthorizationRequest(input: {
    redirectUri: string;
    loginHint?: string;
  }): AuthorizationRequest | NotConfigured {
    if (!client) return notConfigured('missing-settings');
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    if (input.loginHint) params.set('login_hint', input.loginHint);
    return {
      kind: 'ready',
      url: `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`,
      state,
      codeVerifier,
    };
  }

  /** Finishes sign-in from the callback query. Checks `state` before anything else. */
  async function exchangeCode(input: {
    callback: CallbackQuery;
    expectedState: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<TokenOutcome> {
    if (!client) return notConfigured('missing-settings');
    const { callback } = input;
    if (!sameText(callback.state, input.expectedState)) return reconnect('state-mismatch');
    if (callback.error)
      return reconnect(callback.error === 'access_denied' ? 'cancelled' : 'sign-in-failed');
    if (!callback.code) return reconnect('sign-in-failed');
    const result = await requestTokens({
      grant_type: 'authorization_code',
      code: callback.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    });
    if (result.kind !== 'issued') return result;
    const { tokens } = result;
    const missing = missingScopes(tokens.scopes);
    if (missing.length > 0 || !tokens.refreshToken) {
      // Don't leave a half-working grant behind; the person connects again.
      await revoke(tokens.refreshToken ?? tokens.accessToken);
      return missing.length > 0
        ? reconnect('missing-scopes', missing)
        : reconnect('no-refresh-token');
    }
    return { kind: 'connected', tokens: { ...tokens, refreshToken: tokens.refreshToken } };
  }

  /** Gets a new access token. Keeps the refresh token unless Google sends a new one. */
  async function refresh(refreshToken: string): Promise<TokenOutcome> {
    const result = await requestTokens({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (result.kind !== 'issued') return result;
    return {
      kind: 'connected',
      tokens: { ...result.tokens, refreshToken: result.tokens.refreshToken ?? refreshToken },
    };
  }

  /** Ends the grant in Google. Works without client settings; an unknown token counts as done. */
  async function revoke(token: string): Promise<{ kind: 'revoked' } | TemporaryError> {
    let response: Response;
    try {
      response = await post(GOOGLE_REVOKE_URL, { token });
    } catch {
      return temporary('network');
    }
    if (response.status === 429) {
      return temporary(
        'rate-limited',
        parseRetryAfter(response.headers.get('retry-after'), now().getTime()),
      );
    }
    if (response.status >= 500) return temporary('unavailable');
    // 200, or 400 invalid_token: the token is already expired or revoked.
    return { kind: 'revoked' };
  }

  return {
    configured: client !== undefined,
    createAuthorizationRequest,
    exchangeCode,
    refresh,
    revoke,
  };
}
export type GoogleOAuth = ReturnType<typeof createGoogleOAuth>;

/** True when the access token expires within `marginMs` (or its expiry can't be read). */
export function tokensNeedRefresh(
  tokens: Pick<GoogleTokens, 'expiresAt'>,
  now = new Date(),
  marginMs = 60_000,
): boolean {
  const expiresAt = Date.parse(tokens.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt - marginMs <= now.getTime();
}

/** The redirect URL to register in Google Cloud: `<CAREHUB_PUBLIC_URL>/api/calendar/google/callback`. */
export function googleRedirectUri(publicUrl: string): string {
  return `${publicUrl.trim().replace(/\/+$/, '')}/api/calendar/google/callback`;
}

function missingScopes(granted: string[]): string[] {
  const have = new Set(granted);
  return GOOGLE_SCOPES.filter(
    (scope) => !have.has(scope) && !(COVERED_BY[scope] ?? []).some((broader) => have.has(broader)),
  );
}

function sameText(actual: string | null | undefined, expected: string): boolean {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
