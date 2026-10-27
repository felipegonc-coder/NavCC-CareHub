import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  CHECK_END_BYTES,
  CHECK_HEAD_BYTES,
  MAX_UPLOAD_BYTES,
  checkUpload,
  formatBytes,
  needsEnd,
  type UploadCheck,
} from '@carehub/learning';

// Files on disk for the files stand-in: `<dir>/<id>` and its details in `<dir>/<id>.json`, under random IDs
// (never the uploaded name). Uploads stream into `<dir>/tmp/` and move in only once they're accepted.

/** A kept file's details. */
export type StoredFile = {
  id: string;
  scope: string;
  name: string;
  size: number;
  mimeType: string;
  width?: number;
  height?: number;
  createdBy: string;
  createdAt: string;
};

/** Why an upload wasn't kept. `close` means the body wasn't read, so the connection should close. */
export type SaveRefusal = {
  ok: false;
  status: 400 | 413;
  code: 'invalid' | 'too_large';
  message: string;
  close?: true;
};
export type SaveResult = { ok: true; file: StoredFile } | SaveRefusal;

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const dataPath = (dir: string, id: string) => join(dir, id);
const infoPath = (dir: string, id: string) => join(dir, `${id}.json`);
const tempDir = (dir: string) => join(dir, 'tmp');

/** Creates the folder, and clears uploads that a stopped server left half-written. */
export async function prepareFileDir(dir: string): Promise<void> {
  await rm(tempDir(dir), { recursive: true, force: true });
  await mkdir(tempDir(dir), { recursive: true });
}

/** True when the folder's disk has at least `bytes` free. */
export async function hasFreeSpace(dir: string, bytes: number): Promise<boolean> {
  const disk = await statfs(dir);
  return disk.bavail * disk.bsize >= bytes;
}

const refuse = (status: 400 | 413, message: string): SaveRefusal => ({
  ok: false,
  status,
  code: status === 413 ? 'too_large' : 'invalid',
  message,
});
const refusal = (check: Extract<UploadCheck, { ok: false }>): SaveRefusal =>
  refuse(check.problem === 'too_large' ? 413 : 400, check.reason);
const STOPPED = 'The upload stopped before the whole file arrived. Try again.';
const LOW_DISK =
  "Care Hub is almost out of storage space, so it can't take this file. Tell your admin.";

/**
 * Streams an upload of `size` bytes (its Content-Length) to a temporary file, and keeps it under a random ID
 * when `checkUpload` accepts its content. Sizes over the largest upload, or that the disk can't take, are
 * refused before anything is read. Only the first `CHECK_HEAD_BYTES` and last `CHECK_END_BYTES` stay in
 * memory. The type and its size limit are checked as soon as the first bytes arrive; after a refusal the rest
 * is read and dropped, so the answer still reaches the browser. Nothing stays on disk unless the file is kept.
 */
export async function saveUpload(
  dir: string,
  source: Readable,
  input: {
    scope: string;
    name: string;
    size: number;
    userId: string;
    /** Refuses the upload if the disk would have less than this left (default 0). */
    minFreeBytes?: number;
    now?: Date;
  },
): Promise<SaveResult> {
  if (input.size > MAX_UPLOAD_BYTES) {
    const limit = formatBytes(MAX_UPLOAD_BYTES);
    const message = `This file is ${formatBytes(input.size)}. Uploads can be at most ${limit}.`;
    return { ...refuse(413, message), close: true };
  }
  if (!(await hasFreeSpace(dir, input.size + (input.minFreeBytes ?? 0)))) {
    return { ...refuse(413, LOW_DISK), close: true };
  }
  const id = randomUUID();
  const temp = join(tempDir(dir), `${id}.part`);
  const out = createWriteStream(temp, { flags: 'wx' });
  let diskError: Error | undefined;
  out.on('error', (error) => (diskError = error));
  const head: Uint8Array[] = [];
  let headLength = 0;
  let end: Uint8Array = new Uint8Array(0);
  let received = 0;
  let checked = false;
  let refused: SaveRefusal | undefined;
  let kept = false;
  try {
    for await (const chunk of source as AsyncIterable<Uint8Array>) {
      if (refused) continue; // drop the rest
      received += chunk.length;
      if (received > input.size) {
        refused = refuse(400, 'The file is bigger than the size sent with it.');
        break;
      }
      if (headLength < CHECK_HEAD_BYTES) {
        const part = new Uint8Array(chunk.subarray(0, CHECK_HEAD_BYTES - headLength));
        head.push(part);
        headLength += part.length;
      }
      end = lastBytes(end, chunk, CHECK_END_BYTES);
      if (!checked && (headLength >= CHECK_HEAD_BYTES || received === input.size)) {
        checked = true;
        const first = joined(head);
        // Zip and old Office files list what's inside at the end, so they can only be refused for their size yet.
        const early = checkUpload(first, { name: input.name, size: input.size });
        if (!early.ok && (early.problem === 'too_large' || !needsEnd(first))) {
          refused = refusal(early);
          continue;
        }
      }
      if (diskError) throw diskError;
      if (!out.write(chunk)) await once(out, 'drain');
    }
  } catch {
    refused ??= refuse(400, STOPPED); // the browser went away or the disk failed
  }
  try {
    if (refused) return refused;
    if (received < input.size) return refuse(400, STOPPED);
    out.end();
    await finished(out);
    const first = joined(head);
    const check = checkUpload(first, {
      name: input.name,
      size: received,
      end: received > first.length ? end : undefined,
    });
    if (!check.ok) return refusal(check);
    const file: StoredFile = {
      id,
      scope: input.scope,
      name: check.name,
      size: received,
      mimeType: check.mime,
      ...(check.width === undefined ? {} : { width: check.width, height: check.height }),
      createdBy: input.userId,
      createdAt: (input.now ?? new Date()).toISOString(),
    };
    await rename(temp, dataPath(dir, id));
    await writeFile(infoPath(dir, id), JSON.stringify(file), { flag: 'wx' });
    kept = true;
    return { ok: true, file };
  } finally {
    if (!kept) {
      out.destroy();
      await Promise.all([rm(temp, { force: true }), rm(dataPath(dir, id), { force: true })]);
    }
  }
}

/** A stored file's details, or null if there's no such file. */
export async function readStoredFile(dir: string, id: string): Promise<StoredFile | null> {
  if (!FILE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(infoPath(dir, id), 'utf8')) as StoredFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** The file's bytes, or the range from `start` to `end` (included). */
export function openStoredFile(
  dir: string,
  id: string,
  range?: { start: number; end: number },
): ReadStream {
  return createReadStream(dataPath(dir, id), range);
}

/** Deletes a stored file and its details. */
export async function deleteStoredFile(dir: string, id: string): Promise<void> {
  if (!FILE_ID.test(id)) return;
  await rm(infoPath(dir, id), { force: true });
  await rm(dataPath(dir, id), { force: true });
}

function joined(parts: readonly Uint8Array[]): Uint8Array {
  const all = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

/** The last `count` bytes of `before` followed by `chunk`, as a copy. */
function lastBytes(before: Uint8Array, chunk: Uint8Array, count: number): Uint8Array {
  if (chunk.length >= count) return new Uint8Array(chunk.subarray(chunk.length - count));
  const keep = Math.min(before.length, count - chunk.length);
  const out = new Uint8Array(keep + chunk.length);
  out.set(before.subarray(before.length - keep));
  out.set(chunk, keep);
  return out;
}
