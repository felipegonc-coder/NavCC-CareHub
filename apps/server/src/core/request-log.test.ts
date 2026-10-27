import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase } from '../testing';
import { maskUrl, serializeRequest } from './request-log';

// Made up, in the shape of a real link code: randomBytes(16) as base64url.
const CODE = 'Xq3vT9kLm2Pw8RzY4bN1cA';
const ID = '0b7e3c1a-5d2f-4e8b-9a6c-3f1d2e4b5a69';

describe('maskUrl', () => {
  it('hides the rest of a form link, in the web app and in the API', () => {
    expect(maskUrl(`/forms/${CODE}`)).toEqual({ url: '/forms/***', code: true });
    expect(maskUrl(`/api/forms/${CODE}`)).toEqual({ url: '/api/forms/***', code: true });
    expect(maskUrl(`/api/forms/public/${CODE}`)).toEqual({ url: '/api/forms/***', code: true });
    expect(maskUrl(`/api/forms/${CODE}/responses`)).toEqual({ url: '/api/forms/***', code: true });
    expect(maskUrl('/forms/code1')).toEqual({ url: '/forms/***', code: true });
  });

  it('sees through capitals, percent-encoding and doubled slashes', () => {
    for (const url of [
      `/Forms/${CODE}`,
      `/API/FORMS/public/${CODE}`,
      `/%66orms/${CODE}`,
      `/%61pi/forms/${CODE}`,
      `/api%2Fforms%2F${CODE}`,
      `//forms/${CODE}`,
      `/api//forms/${CODE}`,
    ]) {
      const masked = maskUrl(url);
      expect(masked.code, url).toBe(true);
      expect(masked.url, url).not.toContain(CODE);
    }
  });

  it('hides path segments that look like a link code, on any path', () => {
    expect(maskUrl(`/invite/${CODE}`)).toEqual({ url: '/invite/***', code: true });
    expect(maskUrl(`/api/example/${CODE}/accept`)).toEqual({
      url: '/api/example/***/accept',
      code: true,
    });
    expect(maskUrl(`/api/example/feed/${CODE}.ics`)).toEqual({
      url: '/api/example/feed/***.ics',
      code: true,
    });
    expect(maskUrl(`/invite/%58${CODE.slice(1)}`)).toEqual({ url: '/invite/***', code: true });
    const hex = 'a3f9c2e81b7d4f6a0c5e9b2d8f1a7c3e';
    expect(maskUrl(`/reset/${hex}`)).toEqual({ url: '/reset/***', code: true });
  });

  it('keeps IDs, words and the built web files', () => {
    for (const url of [
      '/',
      '/api/health',
      `/p/${ID}`,
      `/api/comments/${ID}/replies`,
      '/learning/courses/getting-started-with-the-care-hub',
      '/settings/notifications',
      '/sw.js',
      '/assets/rich-text-editor-toolbar-DkX9a2Lm.js',
    ]) {
      expect(maskUrl(url)).toEqual({ url, code: false });
    }
  });

  it('hides every query value but keeps the names', () => {
    expect(maskUrl('/api/search?q=Sam%20Example&limit=20')).toEqual({
      url: '/api/search?q=***&limit=***',
      code: false,
    });
    expect(maskUrl('/api/example/callback?code=abc&state=xyz')).toEqual({
      url: '/api/example/callback?code=***&state=***',
      code: false,
    });
    expect(maskUrl(`/api/example?${CODE}`)).toEqual({ url: '/api/example?***', code: false });
    expect(maskUrl(`/api/example?${CODE}=1`)).toEqual({ url: '/api/example?***=***', code: false });
    expect(maskUrl(`/forms/${CODE}?step=2`)).toEqual({ url: '/forms/***?step=***', code: true });
    expect(maskUrl('/api/example?')).toEqual({ url: '/api/example?', code: false });
  });

  it('leaves out the fragment and copes with broken percent-encoding', () => {
    expect(maskUrl(`/forms/${CODE}#top`)).toEqual({ url: '/forms/***', code: true });
    expect(maskUrl('/p/%E0%A4%A')).toEqual({ url: '/p/%E0%A4%A', code: false });
    expect(maskUrl(`/forms/%E0%A4%A${CODE}`)).toEqual({ url: '/forms/***', code: true });
  });
});

describe('serializeRequest', () => {
  const socket = { remoteAddress: '192.0.2.10', remotePort: 51234 };

  it('logs where an ordinary request came from', () => {
    expect(
      serializeRequest({
        method: 'GET',
        url: '/api/health',
        host: 'carehub.example.test',
        ip: '192.0.2.10',
        socket,
      }),
    ).toEqual({
      method: 'GET',
      url: '/api/health',
      host: 'carehub.example.test',
      remoteAddress: '192.0.2.10',
      remotePort: 51234,
    });
  });

  it('leaves out the address when the path had a code', () => {
    const line = serializeRequest({
      method: 'POST',
      url: `/api/forms/public/${CODE}`,
      host: 'carehub.example.test',
      ip: '192.0.2.10',
      socket,
    });
    expect(line).toEqual({ method: 'POST', url: '/api/forms/***', host: 'carehub.example.test' });
    expect(Object.keys(line)).not.toContain('remoteAddress');
  });

  it("reads Node's own request too, which Fastify logs before routing", () => {
    const headers = { host: 'carehub.example.test' };
    expect(serializeRequest({ method: 'GET', url: `/invite/${CODE}`, headers, socket })).toEqual({
      method: 'GET',
      url: '/invite/***',
      host: 'carehub.example.test',
    });
    expect(serializeRequest({ method: 'GET', url: '/', headers, socket })).toEqual({
      method: 'GET',
      url: '/',
      host: 'carehub.example.test',
      remoteAddress: '192.0.2.10',
      remotePort: 51234,
    });
  });
});

/** Request lines (`req`) from a JSON log. */
function requestLines(lines: string[]): Record<string, unknown>[] {
  return lines
    .map((line) => JSON.parse(line) as { req?: Record<string, unknown> })
    .flatMap((entry) => (entry.req ? [entry.req] : []));
}

describe('the Fastify log', () => {
  it('shows request lines without the code or the address', async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: {
        stream: { write: (line: string) => void lines.push(line) },
        serializers: { req: serializeRequest },
      },
    });
    app.get('/forms/:code', async () => 'form');
    app.post('/api/forms/public/:code', async () => ({ ok: true }));
    app.get('/api/health', async () => ({ status: 'ok' }));
    try {
      await app.inject({ method: 'GET', url: `/forms/${CODE}?from=email` });
      await app.inject({ method: 'POST', url: `/api/forms/public/${CODE}`, payload: {} });
      await app.inject({ method: 'GET', url: '/api/health' });
    } finally {
      await app.close();
    }
    expect(lines.join('')).not.toContain(CODE);
    expect(requestLines(lines)).toEqual([
      expect.objectContaining({ method: 'GET', url: '/forms/***?from=***' }),
      expect.objectContaining({ method: 'POST', url: '/api/forms/***' }),
      expect.objectContaining({ method: 'GET', url: '/api/health', remoteAddress: '127.0.0.1' }),
    ]);
    expect(requestLines(lines).map((line) => 'remoteAddress' in line)).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe.skipIf(!hasDatabase)('the server log', () => {
  it('never shows a link code, whatever answers the request', async () => {
    const lines: string[] = [];
    const { app, close } = await createTestApp({
      logger: {
        level: 'trace',
        stream: { write: (line: string) => void lines.push(line) },
        serializers: { req: serializeRequest },
      },
    });
    try {
      for (const url of [
        `/forms/${CODE}`,
        `/api/forms/${CODE}`,
        `/api/forms/public/${CODE}`,
        `/invite/${CODE}`,
        `/api/example/${CODE}`,
      ]) {
        await app.inject({ method: 'GET', url });
      }
      await app.inject({ method: 'POST', url: `/api/forms/public/${CODE}`, payload: {} });
    } finally {
      await close();
    }
    expect(lines.join('')).not.toContain(CODE);
    expect(requestLines(lines).map((line) => line.url)).toEqual(
      expect.arrayContaining(['/forms/***', '/api/forms/***', '/invite/***', '/api/example/***']),
    );
  });
});
