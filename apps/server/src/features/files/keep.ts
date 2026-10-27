import { Readable } from 'node:stream';
import { and, eq, gt, sql } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { anonymousRefusal } from './anonymous';
import { detectFileType, type FileType } from './detect';
import { withPictureEnding } from './names';
import {
  cleanPicture,
  PictureError,
  REDRAW_MAX_PIXELS,
  redrawPicture,
  type CleanedPicture,
} from './pictures';
import { files } from './schema';
import { readFilesSettings } from './settings';
import type { FileStore, ReceivedFile } from './storage';

const MB = 1024 * 1024;
export const PROGRAMS = "Programs can't be uploaded.";
export const NOT_THERE = "Files can't be added there.";
const DAMAGED = "This picture seems to be damaged, so it wasn't uploaded.";
const PAUSED = 'Uploads are paused because the server is almost full.';
const QUOTA = 'No more files can be added here today. Try again tomorrow.';
/** Pictures drawn again for anonymous scopes are read whole into memory. */
const REDRAW_MAX_MB = 64;
const PICTURE_TOO_LARGE =
  `This picture is too large to add here: the limit is ${REDRAW_MAX_PIXELS / 1_000_000} ` +
  `megapixels and ${REDRAW_MAX_MB} MB.`;

/** Where a file goes, and who added it. */
export interface Destination {
  workspaceId: string;
  feature: string;
  scopeId: string;
  /** Null when no one is recorded. Never kept in anonymous scopes. */
  uploadedBy: string | null;
  /** The scope follows the anonymous rules (registered with `allowAnonymous: true`, decision 0010). */
  anonymous?: boolean;
}

/** Where pictures that couldn't be drawn again are reported. */
interface Log {
  warn(details: object, message: string): void;
}

/** Refuses `incoming` more bytes while the disk is almost full (Data settings, DS-08). */
export async function checkFreeSpace(store: FileStore, incoming: number): Promise<void> {
  const floor = readFilesSettings().FILES_MIN_FREE_MB * MB;
  if (floor > 0 && (await store.freeBytes()) - incoming < floor) {
    throw httpError(507, 'too_large', PAUSED);
  }
}

/**
 * Anonymous scopes take at most FILES_ANONYMOUS_DAILY_MB in a day, deleted files included. Checked before
 * an upload, then again as it's recorded, one upload at a time per scope (`lock`, in a transaction).
 */
export async function checkQuota(
  db: Db | Tx,
  to: Destination,
  incoming: number,
  lock = false,
): Promise<void> {
  if (lock) {
    const key = `files-quota:${to.feature}:${to.scopeId}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
  const [row] = await db
    .select({ bytes: sql<string>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(
      and(
        eq(files.scopeFeature, to.feature),
        eq(files.scopeId, to.scopeId),
        gt(files.createdAt, sql`now() - interval '1 day'`),
      ),
    );
  const quota = readFilesSettings().FILES_ANONYMOUS_DAILY_MB * MB;
  if (Number(row?.bytes ?? 0) + Math.max(0, incoming) > quota) {
    throw httpError(429, 'rate_limited', QUOTA);
  }
}

/** The type of the file written to `tempPath`, from its contents (or 'program'). */
export async function fileTypeOf(
  store: FileStore,
  tempPath: string,
  file: ReceivedFile & { name: string },
): Promise<FileType | 'program'> {
  const reader = await store.reader(tempPath);
  return detectFileType({ ...file, read: reader.read }).finally(reader.close);
}

/**
 * Checks a file written to `tempPath` by its contents (unless its `type` is known already), then moves
 * it into place and records it in `db`, which may be the caller's transaction. Programs are refused
 * whatever they're called (Data settings, DS-06), and the type comes from the contents. Pictures are
 * kept without their location, camera and other details (DS-07). In anonymous scopes only some types
 * are taken, pictures are drawn again, no uploader is kept, the daily quota holds, and the file waits to
 * be claimed (claimFiles). When the row can't be saved, the bytes go too.
 */
export async function keepFile(
  db: Db | Tx,
  store: FileStore,
  tempPath: string,
  file: ReceivedFile & { name: string; type?: FileType },
  to: Destination,
  log?: Log,
): Promise<typeof files.$inferSelect> {
  const type = file.type ?? (await fileTypeOf(store, tempPath, file));
  if (type === 'program') throw httpError(400, 'invalid', PROGRAMS);
  let { name } = file;
  if (to.anonymous) {
    const reader = await store.reader(tempPath);
    const refusal = await anonymousRefusal({ ...file, type, read: reader.read }).finally(
      reader.close,
    );
    if (refusal) throw httpError(400, 'invalid', refusal);
    if (type.kind === 'picture') name = withPictureEnding(name, type.mimeType);
  }
  const cleanPath = store.tempPath();
  try {
    const kept = to.anonymous
      ? await drawnAgain(store, tempPath, cleanPath, file, type, log)
      : await withoutDetails(store, tempPath, cleanPath, file, type);
    const storageKey = await store.keep(kept.path);
    const record = (tx: Db | Tx) =>
      tx
        .insert(files)
        .values({
          workspaceId: to.workspaceId,
          scopeFeature: to.feature,
          scopeId: to.scopeId,
          uploadedBy: to.anonymous ? null : to.uploadedBy,
          name,
          mimeType: type.mimeType,
          size: kept.file.size,
          width: kept.width,
          height: kept.height,
          sha256: kept.file.sha256,
          storageKey,
          claimDeadline: to.anonymous ? sql`now() + interval '1 hour'` : null,
        })
        .returning();
    try {
      const [row] = to.anonymous
        ? await (db as Db).transaction(async (tx) => {
            await checkQuota(tx, to, kept.file.size, true);
            return record(tx);
          })
        : await record(db);
      if (!row) throw new Error('The file was not saved.');
      return row;
    } catch (error) {
      await store.remove(store.pathOf(storageKey));
      throw error;
    }
  } finally {
    await store.remove(cleanPath);
  }
}

/** A file as it's kept: where it is now, and for pictures the size they're shown at. */
interface Kept {
  path: string;
  file: ReceivedFile;
  width: number | null;
  height: number | null;
}

/** What cleanPicture finds in the picture at `tempPath`. A damaged one is refused. */
async function readPicture(
  store: FileStore,
  tempPath: string,
  received: ReceivedFile,
  mimeType: string,
): Promise<CleanedPicture | null> {
  const reader = await store.reader(tempPath);
  return cleanPicture(mimeType, { size: received.size, read: reader.read })
    .catch((error: unknown) => {
      throw error instanceof PictureError ? httpError(400, 'invalid', DAMAGED) : error;
    })
    .finally(reader.close);
}

/**
 * What to keep of a checked file: for pictures, a copy at `cleanPath` without their details, and the
 * size they're shown at.
 */
async function withoutDetails(
  store: FileStore,
  tempPath: string,
  cleanPath: string,
  received: ReceivedFile,
  type: FileType,
): Promise<Kept> {
  const plain = { path: tempPath, file: received, width: null, height: null };
  if (type.kind !== 'picture') return plain;
  const picture = await readPicture(store, tempPath, received, type.mimeType);
  if (!picture) return plain;
  const { width, height, pieces } = picture;
  if (!pieces) return { path: tempPath, file: received, width, height };
  return { path: cleanPath, file: await store.rebuild(tempPath, pieces, cleanPath), width, height };
}

/**
 * What to keep in an anonymous scope: pictures (JPEG and PNG only) drawn again at `cleanPath`, upright,
 * from their pixels alone (decision 0200); other files as they are.
 */
async function drawnAgain(
  store: FileStore,
  tempPath: string,
  cleanPath: string,
  received: ReceivedFile,
  type: FileType,
  log?: Log,
): Promise<Kept> {
  if (type.kind !== 'picture') return { path: tempPath, file: received, width: null, height: null };
  const { mimeType } = type;
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
    throw new Error(`${mimeType} pictures can't be drawn again.`);
  }
  const picture = await readPicture(store, tempPath, received, mimeType);
  if (!picture?.width || !picture.height) throw httpError(400, 'invalid', DAMAGED);
  if (picture.width * picture.height > REDRAW_MAX_PIXELS || received.size > REDRAW_MAX_MB * MB) {
    throw httpError(413, 'too_large', PICTURE_TOO_LARGE);
  }
  const original = await store.readAll(tempPath);
  const redrawn = await redrawPicture(mimeType, original, picture.orientation).catch(
    (error: unknown) => {
      if (!(error instanceof PictureError)) throw error;
      log?.warn({ error: error.message }, 'an uploaded picture could not be drawn again');
      throw httpError(400, 'invalid', DAMAGED);
    },
  );
  const bytes = Buffer.from(redrawn.bytes.buffer, redrawn.bytes.byteOffset, redrawn.bytes.length);
  const file = await store.receive(Readable.from([bytes]), cleanPath);
  return { path: cleanPath, file, width: redrawn.width, height: redrawn.height };
}
