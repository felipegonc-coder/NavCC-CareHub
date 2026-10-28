// Test helpers: a stand-in Zoom on this machine (sign-in, refresh, revoke and new meetings), with
// a client ID and secret made for each run. Nothing here talks to the real Zoom.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ZoomUrls } from './zoom';

export interface FakeZoomRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: string;
}

const random = () => randomBytes(12).toString('base64url');
const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeZoom() {
  const clientId = `client-${random()}`;
  const clientSecret = random();
  const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  const failures = new Map<string, { status: number; body: unknown }>();
  const requests: FakeZoomRequest[] = [];
  let meetingId = 81_000_000_000;

  const issue = () => {
    const tokens = { access_token: `zat-${random()}`, refresh_token: `zrt-${random()}` };
    accessTokens.add(tokens.access_token);
    refreshTokens.add(tokens.refresh_token);
    return { ...tokens, token_type: 'bearer', expires_in: 3599, scope: 'meeting:write:meeting' };
  };

  const server = createServer((request, response) => {
    void readBody(request).then((body) => {
      const path = (request.url ?? '').split('?')[0] ?? '';
      const { authorization } = request.headers;
      requests.push({ method: request.method ?? '', path, authorization, body });
      const answer = (status: number, json: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(json));
      };
      const failure = failures.get(path);
      if (failure) {
        failures.delete(path);
        return answer(failure.status, failure.body);
      }
      const form = new URLSearchParams(body);
      if (path === '/oauth/token' || path === '/oauth/revoke') {
        if (authorization !== basic) return answer(401, { error: 'invalid_client' });
      }
      if (path === '/oauth/token' && form.get('grant_type') === 'authorization_code') {
        const code = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const matches = code?.redirectUri === form.get('redirect_uri');
        if (!code || !matches || sha256(verifier) !== code.challenge) {
          return answer(400, { reason: 'Invalid authorization code', error: 'invalid_request' });
        }
        return answer(200, issue());
      }
      if (path === '/oauth/token' && form.get('grant_type') === 'refresh_token') {
        // Like Zoom: a refresh token works once.
        if (!refreshTokens.delete(form.get('refresh_token') ?? '')) {
          return answer(400, { reason: 'Invalid Token!', error: 'invalid_request' });
        }
        return answer(200, issue());
      }
      if (path === '/oauth/revoke') {
        accessTokens.delete(form.get('token') ?? '');
        return answer(200, { status: 'success' });
      }
      if (path === '/v2/users/me/meetings' && request.method === 'POST') {
        if (!accessTokens.has(authorization?.replace(/^Bearer /, '') ?? '')) {
          return answer(401, { code: 124, message: 'Invalid access token.' });
        }
        const { topic } = JSON.parse(body) as { topic: string };
        meetingId += 1;
        const joinUrl = `https://us02web.zoom.us/j/${meetingId}?pwd=${random()}`;
        return answer(201, { id: meetingId, topic, join_url: joinUrl });
      }
      answer(404, { code: 404, message: 'Not found.' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const urls: ZoomUrls = {
    authorize: `${base}/oauth/authorize`,
    token: `${base}/oauth/token`,
    revoke: `${base}/oauth/revoke`,
    api: `${base}/v2`,
  };

  return {
    urls,
    clientId,
    clientSecret,
    requests,
    accessTokens,
    refreshTokens,
    /** The person says yes on the consent page: the code Zoom sends to the redirect URL. */
    approve(authorizeUrl: string): string {
      const { searchParams } = new URL(authorizeUrl);
      const code = `code-${random()}`;
      const challenge = searchParams.get('code_challenge') ?? '';
      codes.set(code, { challenge, redirectUri: searchParams.get('redirect_uri') ?? '' });
      return code;
    },
    /** The next request to `path` gets this answer. */
    fail(path: string, status: number, body: unknown = {}) {
      failures.set(path, { status, body });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type FakeZoom = Awaited<ReturnType<typeof startFakeZoom>>;
