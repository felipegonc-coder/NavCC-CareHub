import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Routes the fake leaves out (404) or fails (500), like `'GET /api/spaces'`. */
export interface FakeOptions {
  /** The password of every @example.test account. */
  password: string;
  missing?: string[];
  failing?: string[];
  pages?: number;
}

export interface FakeCareHub {
  url: string;
  /** Every request, as `METHOD /path` with IDs replaced by `:id`. */
  requests: string[];
  /** Pages made through POST /api/pages. */
  created: string[];
  close: () => Promise<void>;
}

const HTML = `<!doctype html><html><head><script src="/theme-init.js"></script>
<link rel="icon" href="/favicon.svg" /><link rel="stylesheet" href="/assets/app.css">
<link rel="preconnect" href="https://elsewhere.example"></head>
<body><script type="module" src="/assets/app.js"></script></body></html>`;

/**
 * A stand-in for the Care Hub server with the routes the load test uses: the double-submit CSRF
 * cookie, sign-in with one password for every @example.test account, spaces, trees, pages and
 * search.
 */
export async function startFakeCareHub(options: FakeOptions): Promise<FakeCareHub> {
  const { password } = options;
  const sessions = new Map<string, string>();
  const pages = Array.from({ length: options.pages ?? 3 }, (_, i) => ({
    id: randomUUID(),
    title: `Fictional care plan ${i + 1}`,
  }));
  const requests: string[] = [];
  const created: string[] = [];

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://fake.test');
    const route = `${request.method} ${url.pathname.replace(/\/[0-9a-f-]{36}|\/space-\d/g, '/:id')}`;
    requests.push(route);
    const cookies = Object.fromEntries(
      (request.headers.cookie ?? '')
        .split(/;\s*/)
        .map((pair) => pair.split('=') as [string, string]),
    );
    const setCookies: string[] = [];
    if (!cookies.carehub_csrf && url.pathname.startsWith('/api/')) {
      setCookies.push(`carehub_csrf=${randomUUID()}; Path=/; SameSite=Strict`);
    }
    const send = (status: number, body?: unknown, type = 'application/json') => {
      if (setCookies.length > 0) response.setHeader('set-cookie', setCookies);
      if (body === undefined) return void response.writeHead(status).end();
      const text = type === 'application/json' ? JSON.stringify(body) : String(body);
      response.writeHead(status, { 'content-type': type }).end(text);
    };
    if (options.missing?.includes(route)) return send(404, { error: { code: 'not_found' } });
    if (options.failing?.includes(route)) return send(500, { error: { code: 'server' } });
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const writes = request.method !== 'GET' && request.method !== 'HEAD';
    if (
      writes &&
      (!cookies.carehub_csrf || request.headers['x-csrf-token'] !== cookies.carehub_csrf)
    ) {
      return send(403, { error: { code: 'forbidden' } });
    }
    const email = sessions.get(cookies.carehub_session ?? '');

    if (route === 'GET /') return send(200, HTML, 'text/html; charset=utf-8');
    if (
      route.startsWith('GET /assets/') ||
      route === 'GET /theme-init.js' ||
      route === 'GET /favicon.svg'
    ) {
      return send(200, 'x'.repeat(2048), 'text/javascript');
    }
    if (route === 'GET /api/health') return send(200, { status: 'ok', version: 'fake-1' });
    if (route === 'POST /api/auth/sign-in') {
      if (body?.password !== password || !String(body?.email).endsWith('@example.test')) {
        return send(401, { error: { code: 'signed_out' } });
      }
      const token = randomUUID();
      sessions.set(token, body.email);
      setCookies.push(
        `carehub_session=${token}; Path=/; HttpOnly`,
        `carehub_csrf=${randomUUID()}; Path=/`,
      );
      return send(200, { user: { email: body.email } });
    }
    if (!email) return send(401, { error: { code: 'signed_out' } });
    if (route === 'GET /api/auth/me') return send(200, { user: { email } });
    if (route === 'POST /api/auth/sign-out') {
      setCookies.push('carehub_session=; Path=/; Max-Age=0');
      return send(204);
    }
    if (route === 'GET /api/spaces') {
      return send(200, {
        spaces: [{ id: 'space-1', archivedAt: null }],
        privateSpaceId: 'space-2',
      });
    }
    if (route === 'GET /api/spaces/:id/tree') {
      const nodes = url.pathname.includes('space-1')
        ? pages.map((page) => ({ ...page, kind: 'page' }))
        : [];
      return send(200, {
        nodes: [...nodes, { id: randomUUID(), kind: 'database', title: 'Rows' }],
      });
    }
    if (route === 'POST /api/pages') {
      const page = { id: randomUUID(), title: String(body?.title) };
      pages.push(page);
      created.push(page.title);
      return send(201, page);
    }
    if (route === 'GET /api/pages/:id') {
      const page = pages.find((entry) => url.pathname.endsWith(entry.id));
      return page ? send(200, page) : send(404, { error: { code: 'not_found' } });
    }
    if (route === 'POST /api/search/query') {
      const results = pages.slice(0, 2).map((page) => ({ ...page, kind: 'page' }));
      return send(200, { results, total: results.length, nextCursor: null });
    }
    return send(404, { error: { code: 'not_found' } });
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    created,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
