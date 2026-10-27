import { fileParamsSchema, fileUrl, type UploadedFile } from '@carehub/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { files } from './schema';

/** A row of `files`. */
export type StoredFile = typeof files.$inferSelect;

/** A file that isn't deleted, or null: for example to check an icon is a picture of at most 5 MB. */
export async function getFile(db: Db | Tx, id: string): Promise<StoredFile | null> {
  if (!fileParamsSchema.shape.id.safeParse(id).success) return null;
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, id), isNull(files.deletedAt)))
    .limit(1);
  return file ?? null;
}

/** The answer of POST /api/files. */
export function uploadedFileJson(file: StoredFile): UploadedFile {
  const { id, name, size, mimeType, width, height } = file;
  const json: UploadedFile = { id, name, size, mimeType, url: fileUrl(id) };
  return width !== null && height !== null ? { ...json, width, height } : json;
}
