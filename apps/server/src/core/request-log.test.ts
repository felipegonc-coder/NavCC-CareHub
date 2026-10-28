import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, injectAs } from '../testing';
import { logOptions, maskLogLine, maskText, maskUrl, serializeRequest } from './request-log';

// Made up, in the shape of a real link code: randomBytes(16) as base64url.
const CODE = 'Xq3vT9kLm2Pw8RzY4bN1cA';
const ID = '0b7e3c1a-5d2f-4e8b-9a6c-3f1d2e4b5a69';
/** A made-up link code in the shape of a UUID, which only a link word hides. */
const UUID_CODE = '6f1c2b9e-8a4d-4c3b-9e7f-1a2b3c4d5e6f';

describe('maskUrl', () => {
  it('hides the rest of a form link, in the web app and in the API', () => {
    expect(maskUrl(`/forms/${CODE}`)).toEqual({ url: '/forms/***', code: true });
    expect(maskUrl(`/api/forms/${CODE}`)).toEqual({ url: '/api/forms/***', code: true });
    expect(maskUrl(`/api/forms/public/${CODE}`)).toEqual({ url: '/api/forms/***', code: true });
    expect(maskUrl(`/api/forms/public/${CODE}/cover`)).toEqual({
      url: '/api/forms/***',
      code: true,
    });
    expect(maskUrl(`/api/forms/${CODE}/responses`)).toEqual({ url: '/api/forms/***', code: true });
    expect(maskUrl('/forms/code1')).toEqual({ url: '/forms/***', code: true });
  });

  it('hides a form link that sign-in goes back to', () => {
    expect(maskUrl(`/sign-in?next=%2Fforms%2F${CODE}`).url).toBe('/sign-in?next=***');
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
    expect(maskUrl(`/api/example/${CODE}/accept`)).toEqual({
      url: '/api/example/***/accept',
      code: true,
    });
    expect(maskUrl(`/api/example/calendar/${CODE}.ics`)).toEqual({
      url: '/api/example/calendar/***.ics',
      code: true,
    });
    expect(maskUrl(`/api/example/%58${CODE.slice(1)}`)).toEqual({
      url: '/api/example/***',
      code: true,
    });
    const hex = 'a3f9c2e81b7d4f6a0c5e9b2d8f1a7c3e';
    expect(maskUrl(`/api/example/${hex}`)).toEqual({ url: '/api/example/***', code: true });
  });

  it('hides everything after a share, invite, feed or reset word, whatever the code looks like', () => {
    expect(maskUrl(`/share/${UUID_CODE}`)).toEqual({ url: '/share/***', code: true });
    expect(maskUrl(`/invite/${CODE}`)).toEqual({ url: '/invite/***', code: true });
    expect(maskUrl('/api/example/invites/k3x9/accept')).toEqual({
      url: '/api/example/invites/***',
      code: true,
    });
    expect(maskUrl(`/api/calendar/feed/${CODE}.ics`)).toEqual({
      url: '/api/calendar/feed/***',
      code: true,
    });
    expect(maskUrl(`/api/calendar/feeds/${UUID_CODE}/events.ics`)).toEqual({
      url: '/api/calendar/feeds/***',
      code: true,
    });
    expect(maskUrl('/Reset/abc')).toEqual({ url: '/Reset/***', code: true });
    expect(maskUrl('/%73hare/abc?from=email')).toEqual({
      url: '/%73hare/***?from=***',
      code: true,
    });
  });

  it('keeps IDs, words and the built web files', () => {
    for (const url of [
      '/',
      '/api/health',
      `/p/${ID}`,
      `/api/comments/${ID}/replies`,
      `/api/pages/${ID}/share`,
      '/settings/invites',
      '/api/home/feed',
      '/share/',
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

describe('maskText', () => {
  it('hides link codes in the paths a message quotes', () => {
    expect(maskText(`Route GET:/forms/${CODE} not found`)).toBe('Route GET:/forms/*** not found');
    expect(
      maskText(
        `Reply was already sent, did you forget to "return reply" in the "/api/forms/public/${CODE}/cover" (GET) route?`,
      ),
    ).toBe(
      'Reply was already sent, did you forget to "return reply" in the "/api/forms/***" (GET) route?',
    );
    expect(maskText('Open https://carehub.example.test/forms/code1?from=email')).toBe(
      'Open https://carehub.example.test/forms/***?from=***',
    );
    expect(maskText(`back to /sign-in?next=%2Fforms%2F${CODE}`)).toBe('back to /sign-in?next=***');
    expect(maskText(`Error: no link /share/${UUID_CODE}\n    at open (/app/server.js:1:2)`)).toBe(
      'Error: no link /share/***\n    at open (/app/server.js:1:2)',
    );
  });

  it('leaves other text alone', () => {
    for (const text of [
      'incoming request',
      'Server listening at http://127.0.0.1:3000',
      'Server listening at http://[::1]:3000',
      '    at handler (/app/apps/server/src/app.ts:10:5)',
      'text/html; charset=utf-8',
      `GET /api/comments/${ID}/replies`,
    ]) {
      expect(maskText(text)).toBe(text);
    }
  });
});

describe('maskLogLine', () => {
  it('masks every text in a log line, such as an error that quotes the URL', () => {
    const line = `${JSON.stringify({
      level: 50,
      reqId: 'req-1',
      err: {
        type: 'Error',
        message: `Couldn't open /forms/${CODE}`,
        stack: `Error: Couldn't open /forms/${CODE}\n    at open (/app/server.js:1:2)`,
        rawPacket: { type: 'Buffer', data: [71, 69, 84, 32, 47] },
      },
      error: { type: 'Error', cause: { message: `/api/forms/public/${CODE}` } },
      msg: `Route GET:/share/${UUID_CODE} not found`,
    })}\n`;
    const masked = maskLogLine(line);
    expect(masked.endsWith('}\n')).toBe(true);
    expect(JSON.parse(masked)).toEqual({
      level: 50,
      reqId: 'req-1',
      err: {
        type: 'Error',
        message: "Couldn't open /forms/***",
        stack: "Error: Couldn't open /forms/***\n    at open (/app/server.js:1:2)",
      },
      error: { type: 'Error', cause: { message: '/api/forms/***' } },
      msg: 'Route GET:/share/*** not found',
    });
  });

  it('keeps other lines as they are', () => {
    const line =
      '{"level":30,"time":1,"reqId":"req-1","req":{"method":"GET","url":"/api/health"},"msg":"incoming request"}\n';
    expect(maskLogLine(line)).toBe(line);
    expect(maskLogLine(`not JSON: /forms/${CODE}`)).toBe('not JSON: /forms/***');
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

/** A log stream that keeps the lines it gets. */
function streamTo(lines: string[]) {
  return { write: (line: string) => void lines.push(line) };
}

/** Request lines (`req`) from a JSON log. */
function requestLines(lines: string[]): Record<string, unknown>[] {
  return lines
    .map((line) => JSON.parse(line) as { req?: Record<string, unknown> })
    .flatMap((entry) => (entry.req ? [entry.req] : []));
}

describe('the Fastify log', () => {
  it('shows request lines without the code or the address', async () => {
    const lines: string[] = [];
    const app = Fastify({ logger: { ...logOptions(), stream: streamTo(lines) } });
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

  it("hides codes in Fastify's own lines: not found, errors and warnings", async () => {
    const lines: string[] = [];
    const app = Fastify({ logger: { ...logOptions(), stream: streamTo(lines) } });
    app.get('/forms/:code/fail', async (request) => {
      throw new Error(`Couldn't open ${request.url}`);
    });
    // Sends twice, so Fastify warns with the URL in the message.
    app.get('/forms/:code', async (_request, reply) => {
      reply.send('form');
      return 'again';
    });
    try {
      await app.inject({ method: 'GET', url: `/api/forms/public/${CODE}/cover` });
      await app.inject({ method: 'GET', url: `/forms/${CODE}/fail` });
      await app.inject({ method: 'GET', url: `/forms/${CODE}` });
    } finally {
      await app.close();
    }
    const log = lines.join('');
    expect(log).not.toContain(CODE);
    expect(log).toContain('Route GET:/api/forms/*** not found');
    expect(log).toContain("Couldn't open /forms/***");
    expect(log).toContain('FST_ERR_REP_ALREADY_SENT');
  });
});

// CI always has Postgres, so there the whole-server test below runs instead of being skipped.
it.runIf(Boolean(process.env.CI))('has a database in CI, for the whole-server test', () => {
  expect(hasDatabase).toBe(true);
});

describe.skipIf(!hasDatabase)('the server log', () => {
  it('never shows a link code, or who answered a form', async () => {
    const lines: string[] = [];
    const email = 'form-answer@example.test';
    const { app, db, close } = await createTestApp({
      logger: { ...logOptions(), level: 'trace', stream: streamTo(lines) },
      // Stand-ins for the public form routes (decision 0010), which aren't written yet.
      routes: (instance) => {
        instance.post('/api/forms/public/:code', { config: { public: true } }, async () => ({
          ok: true,
        }));
        instance.get(
          '/api/forms/public/:code/fail',
          { config: { public: true } },
          async (request) => {
            throw new Error(`Couldn't open ${request.url}`);
          },
        );
      },
    });
    try {
      for (const url of [
        `/forms/${CODE}`,
        `/api/forms/${CODE}`,
        `/api/forms/public/${CODE}/cover`,
        `/api/forms/public/${CODE}/fail`,
        `/sign-in?next=%2Fforms%2F${CODE}`,
        `/invite/${CODE}`,
        `/share/${UUID_CODE}`,
        `/api/example/${CODE}`,
      ]) {
        await app.inject({ method: 'GET', url });
      }
      const person = await createUser(db, { email });
      const answer = await injectAs(app, person, {
        method: 'POST',
        url: `/api/forms/public/${CODE}`,
        payload: {},
      });
      expect(answer.statusCode).toBe(200);

      const log = lines.join('');
      for (const secret of [CODE, UUID_CODE, person.id, email]) {
        expect(log, secret).not.toContain(secret);
      }
      expect(log).toContain("Couldn't open /api/forms/***");
      const requests = requestLines(lines);
      expect(requests.map((line) => line.url)).toEqual(
        expect.arrayContaining([
          '/forms/***',
          '/api/forms/***',
          '/sign-in?next=***',
          '/invite/***',
          '/share/***',
          '/api/example/***',
        ]),
      );
      // Form requests, the answer sent signed in among them, say nothing of where they came from.
      const forms = requests.filter((line) => line.url === '/api/forms/***');
      expect(forms.length).toBeGreaterThan(1);
      expect(forms.filter((line) => 'remoteAddress' in line)).toEqual([]);
    } finally {
      await close();
    }
  });
});
