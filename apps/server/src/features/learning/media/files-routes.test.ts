import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FILE_CSP } from './file-http';
import { filesStandInAllowed, type FilesStandInOptions } from './files-routes';
import mediaRoutes from './routes';

const MB = 1024 * 1024;
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const png = (width: number, height: number) =>
  Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'),
    Buffer.from([...be32(13), ...Buffer.from('IHDR'), ...be32(width), ...be32(height)]),
    Buffer.from([8, 6, 0, 0, 0, ...be32(0)]),
  ]);

// Fictional people: Ana and Dee edit course-1, Ben takes it, Cy has nothing to do with it.
const editors = new Set<string>();
const learners = new Set<string>();
let dir: string;
let app: FastifyInstance | undefined;

async function build(files: FilesStandInOptions = {}): Promise<FastifyInstance> {
  app = Fastify();
  await app.register(mediaRoutes, {
    courses: {
      canSeeCourse: async (userId: string, courseId: string) =>
        courseId === 'course-1' && (editors.has(userId) || learners.has(userId)),
      canEditCourse: async (userId: string, courseId: string) =>
        courseId === 'course-1' && editors.has(userId),
    },
    files: {
      dir,
      minFreeBytes: 0,
      getUser: (request: FastifyRequest) => {
        const user = request.headers['x-test-user'];
        return typeof user === 'string' ? { id: user } : null;
      },
      ...files,
    },
  });
  return app;
}

const as = (user: string | null): Record<string, string> => (user ? { 'x-test-user': user } : {});

type UploadOptions = {
  user?: string | null;
  name?: string;
  scope?: string;
  headers?: Record<string, string>;
};
function upload(
  api: FastifyInstance,
  body: Buffer | undefined,
  { user = 'ana', name = 'Ward map.png', scope = 'learning:course-1', headers }: UploadOptions = {},
) {
  return api.inject({
    method: 'POST',
    url: `/files?scope=${encodeURIComponent(scope)}`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(name),
      ...as(user),
      ...headers,
    },
    payload: body,
  });
}

function read(api: FastifyInstance, url: string, user: string | null = 'ben', range?: string) {
  const headers = as(user);
  if (range) headers.range = range;
  return api.inject({ method: 'GET', url, headers });
}

async function uploaded(api: FastifyInstance, bytes: Buffer, options?: UploadOptions) {
  const answer = await upload(api, bytes, options);
  expect(answer.statusCode).toBe(201);
  return answer.json() as { id: string; url: string };
}

/** Starts Ana's upload over a real connection and sends only its first 8 bytes, like a slow upload. */
function slowUpload(address: string, bytes: Buffer) {
  const sending = httpRequest(`${address}/files?scope=learning%3Acourse-1`, {
    method: 'POST',
    agent: false,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': bytes.length,
      'x-file-name': 'Ward%20map.png',
      'x-test-user': 'ana',
    },
  });
  const status = new Promise<number | undefined>((resolve, reject) => {
    sending.on('response', (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    sending.on('error', reject);
  });
  sending.write(bytes.subarray(0, 8));
  return { status, finish: () => sending.end(bytes.subarray(8)) };
}

/** Waits until `ready()` is true (polling), or fails after two seconds. */
async function until(ready: () => Promise<boolean>) {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out.');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'carehub-learning-files-routes-'));
  editors.clear();
  learners.clear();
  editors.add('ana').add('dee');
  learners.add('ben');
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe('POST /files', () => {
  it("keeps an upload and answers in the shape of core's files API", async () => {
    const api = await build();
    const bytes = png(40, 30);
    const answer = await upload(api, bytes, { name: 'maps/Café plan.png' });
    expect(answer.statusCode).toBe(201);
    const { id } = answer.json() as { id: string };
    expect(answer.json()).toEqual({
      id,
      name: 'Café plan.png',
      size: bytes.length,
      mimeType: 'image/png',
      url: `/files/${id}`,
      width: 40,
      height: 30,
    });
    expect((await readdir(dir)).sort()).toEqual([id, `${id}.json`, 'tmp']);
  });

  it('refuses before reading the file when it can, and closes the connection', async () => {
    const api = await build();
    const bytes = png(10, 10);
    const tooBig = { 'content-length': String(60 * MB) };
    const cases = [
      [await upload(api, bytes, { user: null }), 401, 'signed_out'],
      [await upload(api, bytes, { scope: 'teams:board-1' }), 400, 'invalid'],
      [await upload(api, bytes, { scope: 'learning:../course-1' }), 400, 'invalid'],
      [await upload(api, bytes, { user: 'ben' }), 403, 'forbidden'],
      [await upload(api, bytes, { scope: 'learning:course-2' }), 403, 'forbidden'],
      [await upload(api, Buffer.alloc(0)), 400, 'invalid'],
      [await upload(api, bytes, { headers: tooBig }), 413, 'too_large'],
    ] as const;
    for (const [answer, status, code] of cases) {
      expect({ status: answer.statusCode, code: answer.json().error.code }).toEqual({
        status,
        code,
      });
      expect(answer.headers.connection).toBe('close');
    }
    const noSize = await upload(api, undefined, { headers: { 'transfer-encoding': 'chunked' } });
    expect(noSize.statusCode).toBe(400);
    expect(noSize.json()).toEqual({ error: { code: 'invalid', message: "Send the file's size." } });
    const tooBigAnswer = await upload(api, bytes, { headers: tooBig });
    expect(tooBigAnswer.json().error.message).toBe(
      'This file is 60 MB. Uploads can be at most 50 MB.',
    );
    const asPng = await upload(api, bytes, { headers: { 'content-type': 'image/png' } });
    expect(asPng.statusCode).toBe(415);
    expect(await readdir(dir)).toEqual(['tmp']);
  });

  it('goes by what is in the file, so programs and SVG are refused', async () => {
    const api = await build();
    const program = await upload(api, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2 * MB)]));
    expect(program.statusCode).toBe(400);
    expect(program.json()).toEqual({
      error: { code: 'invalid', message: "Programs and scripts can't be uploaded." },
    });
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const picture = await upload(api, svg, { name: 'logo.svg' });
    expect(picture.statusCode).toBe(400);
    expect(picture.json().error.message).toMatch(/^SVG pictures can contain code/);
    const huge = await upload(api, Buffer.concat([png(10, 10), Buffer.alloc(11 * MB)]));
    expect(huge.statusCode).toBe(413);
    expect(huge.json().error.message).toBe('This picture is 11 MB. Pictures can be at most 10 MB.');
    expect(await readdir(dir)).toEqual(['tmp']);
    expect(await readdir(join(dir, 'tmp'))).toEqual([]);
  });

  it('lets each person run only a few uploads at once', async () => {
    const api = await build({ maxUploadsEach: 1 });
    const address = await api.listen({ port: 0, host: '127.0.0.1' });
    const bytes = png(10, 10);
    const first = slowUpload(address, bytes);
    await until(async () => (await readdir(join(dir, 'tmp'))).length === 1);
    const second = await upload(api, bytes);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('rate_limited');
    expect((await upload(api, bytes, { user: 'dee' })).statusCode).toBe(201);
    first.finish();
    expect(await first.status).toBe(201);
    expect((await upload(api, bytes)).statusCode).toBe(201);
  });

  it('refuses uploads when the disk is nearly full', async () => {
    const api = await build({ minFreeBytes: Number.MAX_SAFE_INTEGER });
    const answer = await upload(api, png(10, 10));
    expect(answer.statusCode).toBe(413);
    expect(answer.json().error.message).toMatch(/almost out of storage space/);
  });
});

describe('GET /files/:id', () => {
  it('sends the file sandboxed and never sniffed, checking access on every read', async () => {
    const api = await build();
    const bytes = png(40, 30);
    const { url } = await uploaded(api, bytes, { name: 'Café plan.png' });
    const file = await read(api, url);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload).toEqual(bytes);
    expect(file.headers).toMatchObject({
      'content-type': 'image/png',
      'content-length': String(bytes.length),
      'content-disposition': `inline; filename="Caf_ plan.png"; filename*=UTF-8''Caf%C3%A9%20plan.png`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': FILE_CSP,
      'cache-control': 'private, no-store',
    });
    expect((await read(api, url, null)).statusCode).toBe(401);
    expect((await read(api, url, 'cy')).statusCode).toBe(403);
    learners.delete('ben');
    const removed = await read(api, url, 'ben');
    expect(removed.statusCode).toBe(403);
    expect(removed.json()).toEqual({
      error: { code: 'forbidden', message: "You don't have access to this." },
    });
    for (const missing of ['/files/0b6f8a8e-9a43-4c1e-8f6e-2f7f4f1d6c11', '/files/notes']) {
      expect((await read(api, missing, 'ana')).statusCode).toBe(404);
    }
  });

  it('sends parts of a file, and downloads when asked', async () => {
    const api = await build();
    const bytes = png(40, 30);
    const { url } = await uploaded(api, bytes);
    const part = await read(api, url, 'ben', 'bytes=0-3');
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-3/${bytes.length}`);
    expect(part.rawPayload).toEqual(bytes.subarray(0, 4));
    const past = await read(api, url, 'ben', `bytes=${bytes.length}-`);
    expect(past.statusCode).toBe(416);
    expect(past.headers['content-range']).toBe(`bytes */${bytes.length}`);
    const download = await read(api, `${url}?download=1`);
    expect(download.headers['content-disposition']).toMatch(/^attachment; /);
    const head = await api.inject({ method: 'HEAD', url, headers: as('ben') });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe(String(bytes.length));
    expect(head.rawPayload.length).toBe(0);
  });
});

describe('DELETE /files/:id', () => {
  it('lets course editors delete files', async () => {
    const api = await build();
    const { id, url } = await uploaded(api, png(4, 4));
    const remove = (user: string) =>
      api.inject({ method: 'DELETE', url, headers: { 'x-test-user': user } });
    expect((await remove('ben')).statusCode).toBe(403);
    expect((await remove('ana')).statusCode).toBe(204);
    expect((await read(api, url, 'ana')).statusCode).toBe(404);
    expect(await readdir(dir)).not.toContain(id);
  });
});

describe('the files stand-in', () => {
  it('never runs in production', async () => {
    expect(filesStandInAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(filesStandInAllowed({ NODE_ENV: 'development' })).toBe(true);
    expect(filesStandInAllowed({})).toBe(true);
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const api = await build();
      expect((await upload(api, png(4, 4))).statusCode).toBe(404);
    } finally {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    }
  });
});
