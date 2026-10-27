import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { detectFileType, type FileType } from './detect';
import { cleanPicture, PictureError } from './pictures';
import { files } from './schema';
import { readFilesSettings } from './settings';
import type { FileStore, ReceivedFile } from './storage';

const MB = 1024 * 1024;
export const PROGRAMS = "Programs can't be uploaded.";
export const NOT_THERE = "Files can't be added there.";
const DAMAGED = "This picture seems to be damaged, so it wasn't uploaded.";
const PAUSED = 'Uploads are paused because the server is almost full.';

/** Where a file goes, and who added it. */
export interface Destination {
  workspaceId: string;
  feature: string;
  scopeId: string;
  /** Null when no one is recorded. */
  uploadedBy: string | null;
}

/** Refuses `incoming` more bytes while the disk is almost full (Data settings, DS-08). */
export async function checkFreeSpace(store: FileStore, incoming: number): Promise<void> {
  const floor = readFilesSettings().FILES_MIN_FREE_MB * MB;
  if (floor > 0 && (await store.freeBytes()) - incoming < floor) {
    throw httpError(507, 'too_large', PAUSED);
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
 * kept without their location, camera and other details (DS-07). When the row can't be saved, the
 * bytes go too.
 */
export async function keepFile(
  db: Db | Tx,
  store: FileStore,
  tempPath: string,
  file: ReceivedFile & { name: string; type?: FileType },
  to: Destination,
): Promise<typeof files.$inferSelect> {
  const type = file.type ?? (await fileTypeOf(store, tempPath, file));
  if (type === 'program') throw httpError(400, 'invalid', PROGRAMS);
  const cleanPath = store.tempPath();
  try {
    const kept = await withoutDetails(store, tempPath, cleanPath, file, type);
    const storageKey = await store.keep(kept.path);
    try {
      const [row] = await db
        .insert(files)
        .values({
          workspaceId: to.workspaceId,
          scopeFeature: to.feature,
          scopeId: to.scopeId,
          uploadedBy: to.uploadedBy,
          name: file.name,
          mimeType: type.mimeType,
          size: kept.file.size,
          width: kept.width,
          height: kept.height,
          sha256: kept.file.sha256,
          storageKey,
        })
        .returning();
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
): Promise<{ path: string; file: ReceivedFile; width: number | null; height: number | null }> {
  const plain = { path: tempPath, file: received, width: null, height: null };
  if (type.kind !== 'picture') return plain;
  const reader = await store.reader(tempPath);
  const picture = await cleanPicture(type.mimeType, { size: received.size, read: reader.read })
    .catch((error: unknown) => {
      throw error instanceof PictureError ? httpError(400, 'invalid', DAMAGED) : error;
    })
    .finally(reader.close);
  if (!picture) return plain;
  const { width, height, pieces } = picture;
  if (!pieces) return { path: tempPath, file: received, width, height };
  return { path: cleanPath, file: await store.rebuild(tempPath, pieces, cleanPath), width, height };
}
