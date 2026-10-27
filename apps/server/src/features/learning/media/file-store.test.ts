import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteStoredFile,
  hasFreeSpace,
  openStoredFile,
  prepareFileDir,
  readStoredFile,
  saveUpload,
} from './file-store';

const MB = 1024 * 1024;
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const png = (width: number, height: number) =>
  Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'),
    Buffer.from([...be32(13), ...Buffer.from('IHDR'), ...be32(width), ...be32(height)]),
    Buffer.from([8, 6, 0, 0, 0, ...be32(0)]),
  ]);
const zipEntry = (name: string) =>
  Buffer.concat([
    Buffer.from('PK\x03\x04', 'latin1'),
    Buffer.alloc(22),
    Buffer.from([name.length, 0, 0, 0]),
    Buffer.from(name),
  ]);
/** The bytes as a stream of 64 KB chunks, like a request body. */
const body = (bytes: Uint8Array) =>
  Readable.from(
    (function* () {
      for (let at = 0; at < bytes.length; at += 64 * 1024) {
        yield Buffer.from(bytes.subarray(at, at + 64 * 1024));
      }
    })(),
  );
const MACROS =
  "Documents with macros can't be uploaded. Save it without macros (as .docx, .xlsx or .pptx) and upload it again.";
const STOPPED = 'The upload stopped before the whole file arrived. Try again.';

let dir: string;
const save = (
  bytes: Uint8Array,
  name = 'Ward map.png',
  size = bytes.length,
  source = body(bytes),
) =>
  saveUpload(dir, source, {
    scope: 'learning:course-1',
    name,
    size,
    userId: 'user-1',
    now: new Date('2026-10-27T09:00:00Z'),
  });
const halfWritten = async () => (await readdir(join(dir, 'tmp'))).length;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'carehub-learning-files-test-'));
  await prepareFileDir(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('saveUpload', () => {
  it('keeps an accepted file under a random ID, with its details', async () => {
    const bytes = Buffer.concat([png(40, 30), Buffer.alloc(200 * 1024)]);
    const saved = await save(bytes, 'maps/Ward map.png');
    if (!saved.ok) throw new Error(saved.message);
    const { id } = saved.file;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(saved.file).toEqual({
      id,
      scope: 'learning:course-1',
      name: 'Ward map.png',
      size: bytes.length,
      mimeType: 'image/png',
      width: 40,
      height: 30,
      createdBy: 'user-1',
      createdAt: '2026-10-27T09:00:00.000Z',
    });
    expect(await readFile(join(dir, id))).toEqual(bytes);
    expect(await readStoredFile(dir, id)).toEqual(saved.file);
    expect((await readdir(dir)).sort()).toEqual([id, `${id}.json`, 'tmp']);
    expect(await halfWritten()).toBe(0);
  });

  it('refuses a program from its first bytes, reads the rest and keeps nothing', async () => {
    const program = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(3 * MB)]);
    const source = body(program);
    expect(await save(program, 'tool.png', program.length, source)).toEqual({
      ok: false,
      status: 400,
      code: 'invalid',
      message: "Programs and scripts can't be uploaded.",
    });
    expect(source.readableEnded).toBe(true);
    expect(await readdir(dir)).toEqual(['tmp']);
    expect(await halfWritten()).toBe(0);
  });

  it('refuses SVG pictures', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(await save(svg, 'logo.svg')).toMatchObject({
      ok: false,
      status: 400,
      message:
        "SVG pictures can contain code, so they can't be uploaded. Save it as PNG and upload it again.",
    });
  });

  it('holds each type to its size limit as soon as the type is known', async () => {
    const big = Buffer.concat([png(40, 30), Buffer.alloc(11 * MB)]);
    expect(await save(big)).toEqual({
      ok: false,
      status: 413,
      code: 'too_large',
      message: 'This picture is 11 MB. Pictures can be at most 10 MB.',
    });
    expect(await halfWritten()).toBe(0);
  });

  it('refuses a size over the largest upload without reading the body', async () => {
    const source = body(png(1, 1));
    expect(await save(png(1, 1), 'tour.mp4', 60 * MB, source)).toEqual({
      ok: false,
      status: 413,
      code: 'too_large',
      message: 'This file is 60 MB. Uploads can be at most 50 MB.',
      close: true,
    });
    expect(source.readableEnded).toBe(false);
  });

  it('refuses a file the disk would be too full for, without reading it', async () => {
    const source = body(png(1, 1));
    const answer = await saveUpload(dir, source, {
      scope: 'learning:course-1',
      name: 'a.png',
      size: 100,
      userId: 'user-1',
      minFreeBytes: Number.MAX_SAFE_INTEGER,
    });
    expect(answer).toEqual({
      ok: false,
      status: 413,
      code: 'too_large',
      message:
        "Care Hub is almost out of storage space, so it can't take this file. Tell your admin.",
      close: true,
    });
    expect(source.readableEnded).toBe(false);
    expect(await halfWritten()).toBe(0);
  });

  it('refuses uploads that stop early or run past their size', async () => {
    const bytes = png(10, 10);
    expect(await save(bytes, 'a.png', bytes.length + 10)).toMatchObject({
      ok: false,
      message: STOPPED,
    });
    expect(await save(bytes, 'a.png', bytes.length - 1)).toMatchObject({
      ok: false,
      message: 'The file is bigger than the size sent with it.',
    });
    const broken = new Readable({
      read() {
        this.destroy(new Error('connection reset'));
      },
    });
    expect(await save(bytes, 'a.png', bytes.length, broken)).toMatchObject({
      ok: false,
      message: STOPPED,
    });
    expect(await halfWritten()).toBe(0);
  });

  it("reads what's inside a big zip from its end", async () => {
    const docx = Buffer.concat([
      zipEntry('[Content_Types].xml'),
      Buffer.alloc(2 * MB),
      zipEntry('word/document.xml'),
    ]);
    expect(await save(docx, 'Rota.docx')).toMatchObject({
      ok: true,
      file: {
        name: 'Rota.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    });
    const docm = Buffer.concat([
      zipEntry('word/document.xml'),
      Buffer.alloc(2 * MB),
      zipEntry('word/vbaProject.bin'),
    ]);
    expect(await save(docm, 'Rota.docm')).toMatchObject({ ok: false, message: MACROS });
  });
});

describe('stored files', () => {
  const read = async (stream: Readable) => {
    const parts: Buffer[] = [];
    for await (const part of stream) parts.push(part as Buffer);
    return Buffer.concat(parts);
  };

  it('reads all of a file or a range, and deletes it', async () => {
    const bytes = png(2, 2);
    const saved = await save(bytes);
    if (!saved.ok) throw new Error(saved.message);
    const { id } = saved.file;
    expect(await read(openStoredFile(dir, id))).toEqual(bytes);
    expect(await read(openStoredFile(dir, id, { start: 1, end: 3 }))).toEqual(bytes.subarray(1, 4));
    await deleteStoredFile(dir, id);
    expect(await readStoredFile(dir, id)).toBeNull();
    expect(await readdir(dir)).toEqual(['tmp']);
  });

  it('only opens random IDs inside its folder', async () => {
    await writeFile(join(dir, 'notes.json'), '{}');
    for (const id of ['notes', '../notes', 'tmp', ''])
      expect(await readStoredFile(dir, id)).toBeNull();
    await deleteStoredFile(dir, 'notes');
    expect((await readdir(dir)).sort()).toEqual(['notes.json', 'tmp']);
  });

  it('clears half-written uploads when it starts, and checks the free space', async () => {
    await writeFile(join(dir, 'tmp', 'old.part'), 'partial');
    await prepareFileDir(dir);
    expect(await halfWritten()).toBe(0);
    expect(await hasFreeSpace(dir, 0)).toBe(true);
    expect(await hasFreeSpace(dir, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});
