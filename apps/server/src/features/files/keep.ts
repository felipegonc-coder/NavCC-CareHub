import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { detectFileType, type FileType } from './detect';
import { files } from './schema';
import type { FileStore, ReceivedFile } from './storage';

export const PROGRAMS = "Programs can't be uploaded.";
export const NOT_THERE = "Files can't be added there.";

/** Where a file goes, and who added it. */
export interface Destination {
  workspaceId: string;
  feature: string;
  scopeId: string;
  /** Null when no one is recorded. */
  uploadedBy: string | null;
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
 * whatever they're called (Data settings, DS-06), and the type comes from the contents. When the row
 * can't be saved, the bytes go too.
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
  const storageKey = await store.keep(tempPath);
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
        size: file.size,
        sha256: file.sha256,
        storageKey,
      })
      .returning();
    if (!row) throw new Error('The file was not saved.');
    return row;
  } catch (error) {
    await store.remove(store.pathOf(storageKey));
    throw error;
  }
}
