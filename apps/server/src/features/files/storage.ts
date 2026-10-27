import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HEAD_BYTES, type ReadAt } from './detect';

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
 * to FILES_DIR/tmp first and are moved in only once they've passed every check.
 */
export function fileStore(root: string) {
  const tmp = path.join(root, 'tmp');
  const pathOf = (key: string): string => {
    if (!KEY.test(key)) throw new Error('Invalid storage key.');
    return path.join(root, key.slice(0, 2), key.slice(2, 4), key);
  };

  return {
    pathOf,
    /** Empties tmp, which keeps uploads cut off by a restart. Only one server uses FILES_DIR. */
    prepare: (): Promise<void> => rm(tmp, { recursive: true, force: true }),
    tempPath: (): string => path.join(tmp, `${randomUUID()}.part`),
    /** Writes an upload to `tempPath`, measuring and hashing it on the way. */
    async receive(stream: Readable, tempPath: string): Promise<ReceivedFile> {
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
      await pipeline(stream, meter, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
      return { size, sha256: hash.digest('hex'), head: Buffer.concat(head) };
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
    /** Moves a checked upload into place under a new storage key, and returns the key. */
    async keep(tempPath: string): Promise<string> {
      const key = randomUUID();
      const target = pathOf(key);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await rename(tempPath, target);
      return key;
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
