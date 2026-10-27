import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HEAD_BYTES, type ReadAt } from './detect';
import type { Piece } from './pictures';

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ReceivedFile {
  size: number;
  /** SHA-256 of the bytes, in hex. */
  sha256: string;
  /** The first HEAD_BYTES bytes (all of them for smaller files). */
  head: Buffer;
}

/**
 * The bytes of files on disk, at FILES_DIR/<2>/<2>/<storage key> and never under their names. Uploads go
 * to FILES_DIR/tmp first and are moved in only once they've passed every check. FILES_DIR/pending notes
 * the keys of bytes moved in until it's clear their file was recorded (settle).
 */
export function fileStore(root: string) {
  const tmp = path.join(root, 'tmp');
  const pending = path.join(root, 'pending');
  const pathOf = (key: string): string => {
    if (!KEY.test(key)) throw new Error('Invalid storage key.');
    return path.join(root, key.slice(0, 2), key.slice(2, 4), key);
  };

  /** Writes an upload to `tempPath`, measuring and hashing it on the way. */
  const receive = async (stream: Readable, tempPath: string): Promise<ReceivedFile> => {
    await mkdir(tmp, { recursive: true, mode: 0o700 });
    const hash = createHash('sha256');
    const head: Buffer[] = [];
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        if (size < HEAD_BYTES) head.push(chunk.subarray(0, HEAD_BYTES - size));
        size += chunk.length;
        hash.update(chunk);
        done(null, chunk);
      },
    });
    const output = createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
    try {
      await pipeline(stream, meter, output);
    } catch (error) {
      // The file may still be opening: wait until it's closed, so removing it afterwards works.
      if (!output.closed) await new Promise((resolve) => output.once('close', resolve));
      throw error;
    }
    return { size, sha256: hash.digest('hex'), head: Buffer.concat(head) };
  };

  return {
    pathOf,
    /** Empties tmp, which keeps uploads cut off by a restart. Only one server uses FILES_DIR. */
    async prepare(): Promise<void> {
      await rm(tmp, { recursive: true, force: true });
      await mkdir(root, { recursive: true, mode: 0o700 });
    },
    tempPath: (): string => path.join(tmp, `${randomUUID()}.part`),
    receive,
    /** Writes a new file from parts of `source` and new bytes: a picture without its details. */
    rebuild: (source: string, pieces: readonly Piece[], tempPath: string): Promise<ReceivedFile> =>
      receive(Readable.from(piecesOf(source, pieces)), tempPath),
    /** Free space on the disk that holds the files, in bytes. */
    async freeBytes(): Promise<number> {
      const stats = await statfs(root);
      return stats.bavail * stats.bsize;
    },
    /** Reads parts of a file, for example to find its type. Close it when done. */
    async reader(filePath: string): Promise<{ read: ReadAt; close: () => Promise<void> }> {
      const handle = await open(filePath, 'r');
      return {
        read: async (offset, length) => {
          const buffer = Buffer.alloc(Math.max(0, length));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, offset));
          return buffer.subarray(0, bytesRead);
        },
        close: () => handle.close(),
      };
    },
    /** Moves a checked upload into place under a new storage key, noted in pending, and returns the key. */
    async keep(tempPath: string): Promise<string> {
      const key = randomUUID();
      const target = pathOf(key);
      await mkdir(pending, { recursive: true, mode: 0o700 });
      await writeFile(path.join(pending, key), '', { flag: 'wx', mode: 0o600 });
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await rename(tempPath, target);
      return key;
    },
    /** The bytes' file is recorded, or they're gone: their note goes. */
    settle: (key: string): Promise<void> =>
      rm(path.join(pending, path.basename(pathOf(key))), { force: true }).catch(() => undefined),
    /** Keys noted in pending before `before`. */
    async pendingBefore(before: Date): Promise<string[]> {
      const keys: string[] = [];
      for (const key of await readdir(pending).catch(() => [] as string[])) {
        const noted = KEY.test(key) ? await stat(path.join(pending, key)).catch(() => null) : null;
        if (noted && noted.mtime < before) keys.push(key);
      }
      return keys;
    },
    exists: (filePath: string): Promise<boolean> =>
      access(filePath).then(
        () => true,
        () => false,
      ),
    remove: (filePath: string): Promise<void> => rm(filePath, { force: true }),
  };
}

export type FileStore = ReturnType<typeof fileStore>;

async function* piecesOf(source: string, pieces: readonly Piece[]): AsyncGenerator<Buffer> {
  for (const piece of pieces) {
    if (Buffer.isBuffer(piece)) yield piece;
    else if (piece.end > piece.start) {
      for await (const chunk of createReadStream(source, {
        start: piece.start,
        end: piece.end - 1,
      })) {
        yield chunk as Buffer;
      }
    }
  }
}
