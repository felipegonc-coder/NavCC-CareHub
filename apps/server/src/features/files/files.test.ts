import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { deleteFiles, getFiles, registerFileScope, removeDeletedFiles } from './index';
import { files } from './schema';
import { FILE_CSP } from './serve';

const MB = 1024 * 1024;
const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  Buffer.alloc(16),
]);

/** A multipart/form-data body, as a browser sends it. */
function form(parts: Array<{ name: string; filename?: string; data: Buffer | string }>) {
  const boundary = `----carehub-test-${randomBytes(8).toString('hex')}`;
  const chunks = parts.flatMap(({ name, filename, data }) => [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"` +
        (filename === undefined ? '' : `; filename="${filename}"`) +
        '\r\nContent-Type: application/octet-stream\r\n\r\n',
    ),
    Buffer.isBuffer(data) ? data : Buffer.from(data),
    Buffer.from('\r\n'),
  ]);
  return {
    payload: Buffer.concat([...chunks, Buffer.from(`--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe.skipIf(!hasDatabase)('files', () => {
  let testApp: TestApp;
  let filesDir: string;
  let editor: TestUser;
  let reader: TestUser;
  let guest: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    filesDir = await mkdtemp(path.join(tmpdir(), 'carehub-files-'));
    process.env.FILES_DIR = filesDir;
    // A made-up feature: members open its files; only "open" places take uploads, not from the reader.
    registerFileScope('test', {
      canRead: ({ member }) => member.kind === 'member',
      canWrite: ({ user, member, scopeId }) =>
        member.kind === 'member' && scopeId === 'open' && user.name !== 'Test Reader',
    });
    testApp = await createTestApp();
    editor = await createUser(testApp.db);
    reader = await createUser(testApp.db, { name: 'Test Reader' });
    guest = await createUser(testApp.db, { kind: 'guest' });
    outsider = await createUser(testApp.db, { role: null });
  });

  afterAll(async () => {
    await testApp?.close();
    delete process.env.FILES_DIR;
    await rm(filesDir, { recursive: true, force: true });
  });

  const upload = (user: TestUser, data: Buffer | string, filename: string, scope = 'test:open') =>
    injectAs(testApp.app, user, {
      method: 'POST',
      url: `/api/files?scope=${encodeURIComponent(scope)}`,
      ...form([{ name: 'file', filename, data }]),
    });
  const get = (user: TestUser, url: string, headers: Record<string, string> = {}) =>
    injectAs(testApp.app, user, { method: 'GET', url, headers });
  /** Where a file's bytes are on disk. */
  const storedPath = async (id: string) => {
    const [row] = await testApp.db.select().from(files).where(eq(files.id, id));
    const key = row?.storageKey ?? '';
    return path.join(filesDir, key.slice(0, 2), key.slice(2, 4), key);
  };
  const exists = (file: string) =>
    access(file).then(
      () => true,
      () => false,
    );

  it('keeps an upload and gives it back with safe headers', async () => {
    const text = 'Fictional notes for a test.\n';
    const uploaded = await upload(editor, text, 'notes.txt');
    expect(uploaded.statusCode).toBe(201);
    const body = uploaded.json();
    expect(body).toEqual({
      id: expect.any(String),
      name: 'notes.txt',
      size: Buffer.byteLength(text),
      mimeType: 'text/plain',
      url: `/api/files/${body.id}`,
    });

    const read = await get(reader, body.url);
    expect(read.statusCode).toBe(200);
    expect(read.body).toBe(text);
    expect(read.headers).toMatchObject({
      'content-type': 'text/plain',
      'content-disposition': `attachment; filename="notes.txt"; filename*=UTF-8''notes.txt`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': FILE_CSP,
      'cross-origin-resource-policy': 'same-origin',
      'cache-control': 'private, no-cache',
      'accept-ranges': 'bytes',
    });
    expect(read.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);

    const [row] = await testApp.db.select().from(files).where(eq(files.id, body.id));
    expect(await readFile(await storedPath(body.id), 'utf8')).toBe(text);
    expect(row?.uploadedBy).toBe(editor.id);
    expect(await readdir(path.join(filesDir, 'tmp'))).toEqual([]);
  });

  it('shows pictures, and downloads them with ?download=1', async () => {
    const picture = (await upload(editor, PNG, 'Pixel.txt')).json();
    expect(picture.mimeType).toBe('image/png');
    const shown = await get(editor, picture.url);
    expect(shown.headers['content-type']).toBe('image/png');
    expect(shown.headers['content-disposition']).toMatch(/^inline;/);
    const saved = await get(editor, `${picture.url}?download=1`);
    expect(saved.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('downloads web pages and shows SVG only as a sandboxed picture (DS-07)', async () => {
    const page = (
      await upload(editor, '<!doctype html><script>alert(1)</script>', 'page.html')
    ).json();
    expect(page.mimeType).toBe('text/html');
    expect((await get(editor, page.url)).headers['content-disposition']).toMatch(/^attachment;/);

    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const drawing = (await upload(editor, svg, 'drawing.svg')).json();
    expect(drawing.mimeType).toBe('image/svg+xml');
    const shown = await get(editor, drawing.url);
    expect(shown.headers['content-disposition']).toMatch(/^inline;/);
    expect(shown.headers['content-security-policy']).toBe(FILE_CSP);
  });

  it('refuses programs by their contents and by their name (DS-06)', async () => {
    const renamed = await upload(
      editor,
      Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]),
      'setup.pdf',
    );
    expect(renamed.statusCode).toBe(400);
    expect(renamed.json()).toEqual({
      error: { code: 'invalid', message: "Programs can't be uploaded." },
    });
    const byName = await upload(editor, 'echo "fictional"', 'tool.exe');
    expect(byName.statusCode).toBe(400);
    expect(byName.json().error.message).toBe("Programs can't be uploaded.");
    const rows = await testApp.db.select().from(files).where(eq(files.name, 'setup.pdf'));
    expect(rows).toEqual([]);
    expect(await readdir(path.join(filesDir, 'tmp'))).toEqual([]);
  });

  it('refuses files over the limit with their size, and takes them once it is raised (DS-05)', async () => {
    process.env.FILES_MAX_MB = '1';
    try {
      const big = Buffer.alloc(Math.round(1.1 * MB), 'a');
      const refused = await upload(editor, big, 'big.txt');
      expect(refused.statusCode).toBe(413);
      expect(refused.json()).toEqual({
        error: { code: 'too_large', message: 'This file is 1.1 MB; the limit is 1 MB.' },
      });
      // Just over: found while reading, not from the request's length.
      const justOver = await upload(editor, Buffer.alloc(MB + 10_000, 'a'), 'just-over.txt');
      expect(justOver.statusCode).toBe(413);
      expect(justOver.json().error.message).toBe('This file is 1.1 MB; the limit is 1 MB.');
      expect(await readdir(path.join(filesDir, 'tmp'))).toEqual([]);

      process.env.FILES_MAX_MB = '2';
      const accepted = await upload(editor, big, 'big.txt');
      expect(accepted.statusCode).toBe(201);
      expect(accepted.json().size).toBe(big.length);
    } finally {
      delete process.env.FILES_MAX_MB;
    }
  });

  it('answers ranges, HEAD and unchanged-file checks', async () => {
    const { url } = (await upload(editor, '0123456789', 'digits.txt')).json();
    const part = await get(editor, url, { range: 'bytes=2-5' });
    expect(part.statusCode).toBe(206);
    expect(part.body).toBe('2345');
    expect(part.headers['content-range']).toBe('bytes 2-5/10');
    expect(part.headers['content-length']).toBe('4');
    expect((await get(editor, url, { range: 'bytes=-3' })).body).toBe('789');

    const outside = await get(editor, url, { range: 'bytes=10-' });
    expect(outside.statusCode).toBe(416);
    expect(outside.headers['content-range']).toBe('bytes */10');
    const changed = await get(editor, url, { range: 'bytes=2-5', 'if-range': '"changed"' });
    expect(changed.statusCode).toBe(200);
    expect(changed.body).toBe('0123456789');

    const etag = String((await get(editor, url)).headers.etag);
    const unchanged = await get(editor, url, { 'if-none-match': etag });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe('');

    const head = await injectAs(testApp.app, editor, { method: 'HEAD', url });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe('10');
    expect(head.headers.etag).toBe(etag);
    expect(head.body).toBe('');
  });

  it('keeps names readable and safe', async () => {
    const uploaded = (await upload(editor, 'Fictional', 'reports/Résumé – final\u202E.txt')).json();
    expect(uploaded.name).toBe('Résumé – final.txt');
    expect((await get(editor, uploaded.url)).headers['content-disposition']).toBe(
      `attachment; filename="Resume _ final.txt"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%E2%80%93%20final.txt`,
    );
  });

  it('checks who may add and open files', async () => {
    const signedOut = await testApp.app.inject({
      method: 'POST',
      url: '/api/files?scope=test:open',
      ...form([{ name: 'file', filename: 'notes.txt', data: 'Fictional' }]),
    });
    expect(signedOut.statusCode).toBe(401);
    expect((await upload(outsider, 'Fictional', 'notes.txt')).statusCode).toBe(403);
    expect((await upload(reader, 'Fictional', 'notes.txt')).statusCode).toBe(403);
    expect((await upload(editor, 'Fictional', 'notes.txt', 'test:closed')).statusCode).toBe(403);
    expect((await upload(editor, 'Fictional', 'notes.txt', 'unknown:place')).statusCode).toBe(400);
    expect((await upload(editor, 'Fictional', 'notes.txt', 'Not a scope')).statusCode).toBe(400);

    const { url } = (await upload(editor, 'Fictional', 'notes.txt')).json();
    expect((await get(guest, url)).statusCode).toBe(403);
    expect((await get(outsider, url)).statusCode).toBe(403);
    expect((await testApp.app.inject({ method: 'GET', url })).statusCode).toBe(401);

    const missing = await get(editor, `/api/files/${randomUUID()}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.message).toBe('This was deleted, or the link is wrong.');
    expect(missing.headers['content-security-policy']).toBe(FILE_CSP);
    expect(missing.headers['x-content-type-options']).toBe('nosniff');
    expect((await get(editor, '/api/files/not-a-file')).statusCode).toBe(404);
  });

  it('drops an upload cancelled before the end', async () => {
    const { payload, headers } = form([
      { name: 'file', filename: 'cancelled.txt', data: 'Fictional' },
    ]);
    const cancelled = await injectAs(testApp.app, editor, {
      method: 'POST',
      url: '/api/files?scope=test:open',
      payload: payload.subarray(0, payload.length - 20),
      headers,
      simulate: { end: false, split: false, error: false, close: true },
    });
    expect(cancelled.statusCode).toBe(400);
    expect(cancelled.json().error.message).toBe('The upload was cancelled.');
    expect(await readdir(path.join(filesDir, 'tmp'))).toEqual([]);
    const rows = await testApp.db.select().from(files).where(eq(files.name, 'cancelled.txt'));
    expect(rows).toEqual([]);
  });

  it('needs the file in the field "file"', async () => {
    const notForm = await injectAs(testApp.app, editor, {
      method: 'POST',
      url: '/api/files?scope=test:open',
      payload: { file: 'Fictional' },
    });
    expect(notForm.statusCode).toBe(400);
    const wrongField = await injectAs(testApp.app, editor, {
      method: 'POST',
      url: '/api/files?scope=test:open',
      ...form([{ name: 'picture', filename: 'notes.txt', data: 'Fictional' }]),
    });
    expect(wrongField.statusCode).toBe(400);
    expect(wrongField.json().error.message).toBe('Choose a file to upload.');
  });

  it('deletes files for people who may change the place', async () => {
    const { url } = (await upload(editor, 'Fictional', 'delete-me.txt')).json();
    expect((await injectAs(testApp.app, reader, { method: 'DELETE', url })).statusCode).toBe(403);
    expect((await injectAs(testApp.app, editor, { method: 'DELETE', url })).statusCode).toBe(204);
    expect((await get(editor, url)).statusCode).toBe(404);
    expect((await injectAs(testApp.app, editor, { method: 'DELETE', url })).statusCode).toBe(404);
  });

  it('tells other features about files, without an access check', async () => {
    const { id } = (await upload(editor, 'Fictional notes', 'facts.txt')).json();
    const found = await getFiles(testApp.db, [id, id, randomUUID(), 'not-a-file']);
    expect([...found.keys()]).toEqual([id]);
    expect(found.get(id)).toEqual({
      id,
      name: 'facts.txt',
      size: 15,
      mimeType: 'text/plain',
      scope: 'test:open',
      uploadedBy: editor.id,
      createdAt: expect.any(Date),
    });
    expect(await getFiles(testApp.db, [])).toEqual(new Map());
  });

  it("deletes files in the caller's transaction, and their bytes at the clean-up", async () => {
    const kept = (await upload(editor, 'Fictional', 'kept.txt')).json();
    const gone = (await upload(editor, 'Fictional', 'gone.txt')).json();
    const keptPath = await storedPath(kept.id);
    const gonePath = await storedPath(gone.id);

    const rollback = new Error('Rolled back.');
    await expect(
      testApp.db.transaction(async (tx) => {
        expect(await deleteFiles(tx, [kept.id, kept.id])).toBe(1);
        expect(await getFiles(tx, [kept.id])).toEqual(new Map());
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect((await getFiles(testApp.db, [kept.id])).has(kept.id)).toBe(true);

    await testApp.db.transaction(async (tx) => {
      expect(await deleteFiles(tx, [gone.id, randomUUID(), 'not-a-file'])).toBe(1);
    });
    expect((await get(editor, gone.url)).statusCode).toBe(404);
    expect(await exists(gonePath)).toBe(true);
    expect(await removeDeletedFiles(testApp.db)).toBeGreaterThanOrEqual(1);
    expect(await exists(gonePath)).toBe(false);
    expect(await testApp.db.select().from(files).where(eq(files.id, gone.id))).toEqual([]);
    expect(await exists(keptPath)).toBe(true);

    // Bytes that another file still uses stay.
    const [original] = await testApp.db.select().from(files).where(eq(files.id, kept.id));
    if (!original) throw new Error('The file was not saved.');
    const [copy] = await testApp.db
      .insert(files)
      .values({ ...original, id: randomUUID(), createdAt: new Date() })
      .returning();
    expect(await deleteFiles(testApp.db, [kept.id])).toBe(1);
    expect(await removeDeletedFiles(testApp.db)).toBe(1);
    expect(await exists(keptPath)).toBe(true);
    expect((await getFiles(testApp.db, [copy?.id ?? ''])).size).toBe(1);
  });

  it('creates the files table exactly as the Drizzle definition describes it', async () => {
    const { rows } = await testApp.db.execute<{
      name: string;
      type: string;
      not_null: boolean;
      has_default: boolean;
    }>(
      sql`SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
                 attnotnull AS not_null, atthasdef AS has_default
          FROM pg_attribute WHERE attrelid = 'files'::regclass AND attnum > 0 AND NOT attisdropped`,
    );
    const inDatabase = Object.fromEntries(
      rows.map((row) => [
        row.name,
        { type: row.type, notNull: row.not_null, hasDefault: row.has_default },
      ]),
    );
    const inDrizzle = Object.fromEntries(
      getTableConfig(files).columns.map((column) => [
        column.name,
        { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
      ]),
    );
    expect(inDatabase).toEqual(inDrizzle);
  });
});
