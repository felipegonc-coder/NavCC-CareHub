import { Readable } from 'node:stream';
import { fileParamsSchema, fileScopeSchema, fileUrl, type UploadedFile } from '@carehub/shared';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { getDefaultWorkspace } from '../workspaces';
import { hasBlockedEnding } from './detect';
import { keepFile, NOT_THERE, PROGRAMS } from './keep';
import { cleanFileName, tooLargeMessage } from './names';
import { files } from './schema';
import { hasFileScope } from './scopes';
import { readFilesSettings } from './settings';
import { fileStore } from './storage';

/** A row of `files`. */
export type StoredFile = typeof files.$inferSelect;

/** What other features learn about a file with getFiles. */
export interface FileInfo {
  id: string;
  name: string;
  /** In bytes. */
  size: number;
  /** Found from the contents. */
  mimeType: string;
  /** Where it was uploaded: `<feature>:<id>`, for example `messages:<channel id>`. */
  scope: string;
  /** Null once the person's account is deleted. */
  uploadedBy: string | null;
  createdAt: Date;
}

const isFileId = (id: string): boolean => fileParamsSchema.shape.id.safeParse(id).success;

const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Postgres takes at most 65,535 parameters in one query. */
const BATCH = 1000;
function* batches<T>(items: readonly T[]): Generator<T[]> {
  for (let start = 0; start < items.length; start += BATCH) {
    yield items.slice(start, start + BATCH);
  }
}

/** A file that isn't deleted, or null: for example to check an icon is a picture of at most 5 MB. */
export async function getFile(db: Db | Tx, id: string): Promise<StoredFile | null> {
  if (!isFileId(id)) return null;
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, id), isNull(files.deletedAt)))
    .limit(1);
  return file ?? null;
}

/**
 * The files with these IDs that aren't deleted (other IDs are left out). It doesn't check access: check
 * that each file's `scope` is one of yours, and that the person may use it there.
 */
export async function getFiles(
  db: Db | Tx,
  ids: readonly string[],
): Promise<Map<string, FileInfo>> {
  const found = new Map<string, FileInfo>();
  for (const batch of batches([...new Set(ids)].filter(isFileId))) {
    const rows = await db
      .select({
        id: files.id,
        name: files.name,
        size: files.size,
        mimeType: files.mimeType,
        scopeFeature: files.scopeFeature,
        scopeId: files.scopeId,
        uploadedBy: files.uploadedBy,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(and(inArray(files.id, batch), isNull(files.deletedAt)));
    for (const { scopeFeature, scopeId, ...file } of rows) {
      found.set(file.id, { ...file, scope: `${scopeFeature}:${scopeId}` });
    }
  }
  return found;
}

/**
 * Saves `bytes` as a file in `scope` (`<feature>:<id>`) as part of the caller's transaction, for example a
 * file found in something being imported. It's checked as an upload is: at most FILES_MAX_MB, no
 * programs, and the type from the contents. No access check: check that the person may add files there.
 * Throws an HttpError saying why a file can't be saved (400 `invalid`, 413 `too_large`). If the
 * transaction rolls back, the clean-up removes the bytes a day later (removeUnsavedBytes).
 */
export async function saveFile(
  db: Db | Tx,
  file: { scope: string; name: string; bytes: Uint8Array; uploadedBy: string | null },
): Promise<UploadedFile> {
  const feature = file.scope.slice(0, Math.max(0, file.scope.indexOf(':')));
  if (!fileScopeSchema.safeParse(file.scope).success || !hasFileScope(feature)) {
    throw httpError(400, 'invalid', NOT_THERE);
  }
  const { FILES_DIR, FILES_MAX_MB } = readFilesSettings();
  if (file.bytes.length > FILES_MAX_MB * MB) {
    throw httpError(413, 'too_large', tooLargeMessage(file.bytes.length, FILES_MAX_MB));
  }
  const name = cleanFileName(file.name);
  if (hasBlockedEnding(name)) throw httpError(400, 'invalid', PROGRAMS);
  const workspace = await getDefaultWorkspace(db);
  if (!workspace) throw new Error('There is no workspace to keep the file in.');
  const store = fileStore(FILES_DIR);
  const tempPath = store.tempPath();
  try {
    const bytes = Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.length);
    const received = await store.receive(Readable.from([bytes]), tempPath);
    const to = {
      workspaceId: workspace.id,
      feature,
      scopeId: file.scope.slice(feature.length + 1),
      uploadedBy: file.uploadedBy,
    };
    return uploadedFileJson(await keepFile(db, store, tempPath, { ...received, name }, to));
  } finally {
    await store.remove(tempPath);
  }
}

/**
 * Deletes files as part of the caller's transaction, for example with the message they belong to. They're
 * gone at once; their bytes stay on disk for a day (cleanUpFiles), so a rollback keeps them. No access
 * check. Returns how many were deleted.
 */
export async function deleteFiles(db: Db | Tx, ids: readonly string[]): Promise<number> {
  let deleted = 0;
  for (const batch of batches([...new Set(ids)].filter(isFileId))) {
    const rows = await db
      .update(files)
      .set({ deletedAt: sql`now()` })
      .where(and(inArray(files.id, batch), isNull(files.deletedAt)))
      .returning({ id: files.id });
    deleted += rows.length;
  }
  return deleted;
}

/**
 * For the clean-up (cleanUpFiles, Data settings DS-02): removes from disk the bytes of files deleted before
 * `deletedBefore` that no other file shares, then their rows. Bytes that can't be removed keep their row,
 * so they're tried again next time. Returns how many files it removed.
 */
export async function removeDeletedFiles(
  db: Db,
  {
    deletedBefore = new Date(),
    root = readFilesSettings().FILES_DIR,
    signal,
  }: { deletedBefore?: Date; root?: string; signal?: AbortSignal } = {},
): Promise<number> {
  const store = fileStore(root);
  let removed = 0;
  while (!signal?.aborted) {
    const deleted = await db
      .select({ id: files.id, storageKey: files.storageKey })
      .from(files)
      .where(lt(files.deletedAt, deletedBefore))
      .orderBy(asc(files.deletedAt))
      .limit(BATCH);
    if (deleted.length === 0) return removed;
    const keys = [...new Set(deleted.map((file) => file.storageKey))];
    const shared = await db
      .selectDistinct({ storageKey: files.storageKey })
      .from(files)
      .where(and(inArray(files.storageKey, keys), isNull(files.deletedAt)));
    const inUse = new Set(shared.map((file) => file.storageKey));
    const done = new Set<string>();
    for (const key of keys) {
      if (inUse.has(key)) {
        done.add(key);
        continue;
      }
      await store.remove(store.pathOf(key)).then(
        () => done.add(key),
        () => undefined,
      );
    }
    const ids = deleted.filter((file) => done.has(file.storageKey)).map((file) => file.id);
    if (ids.length > 0) await db.delete(files).where(inArray(files.id, ids));
    removed += ids.length;
    if (ids.length < deleted.length || deleted.length < BATCH) return removed;
  }
  return removed;
}

/**
 * The hourly clean-up (routes.ts registers it): removes files deleted over a day ago, so the night's
 * backup still has their bytes (Data settings, DS-02), and bytes whose file was never saved.
 */
export async function cleanUpFiles(
  db: Db,
  {
    now = new Date(),
    root = readFilesSettings().FILES_DIR,
    signal,
  }: { now?: Date; root?: string; signal?: AbortSignal } = {},
): Promise<{ removed: number; unsaved: number }> {
  const deletedBefore = new Date(now.getTime() - DAY_MS);
  const removed = await removeDeletedFiles(db, { deletedBefore, root, signal });
  return { removed, unsaved: await removeUnsavedBytes(db, { now, root, signal }) };
}

/**
 * For the clean-up (cleanUpFiles): removes bytes moved into place over a day ago whose file was never
 * recorded, left by saves that rolled back (saveFile) or stopped half-way. Returns how many it removed.
 */
export async function removeUnsavedBytes(
  db: Db,
  {
    now = new Date(),
    root = readFilesSettings().FILES_DIR,
    signal,
  }: { now?: Date; root?: string; signal?: AbortSignal } = {},
): Promise<number> {
  const store = fileStore(root);
  let removed = 0;
  for (const keys of batches(await store.pendingBefore(new Date(now.getTime() - DAY_MS)))) {
    if (signal?.aborted) break;
    const used = await db
      .selectDistinct({ storageKey: files.storageKey })
      .from(files)
      .where(inArray(files.storageKey, keys));
    const inUse = new Set(used.map((file) => file.storageKey));
    for (const key of keys) {
      const bytes = store.pathOf(key);
      if (!inUse.has(key) && (await store.exists(bytes))) {
        const gone = await store.remove(bytes).then(
          () => true,
          () => false,
        );
        if (!gone) continue; // tried again next time
        removed += 1;
      }
      await store.settle(key);
    }
  }
  return removed;
}

/** The answer of POST /api/files. */
export function uploadedFileJson(file: StoredFile): UploadedFile {
  const { id, name, size, mimeType, width, height } = file;
  const json: UploadedFile = { id, name, size, mimeType, url: fileUrl(id) };
  return width !== null && height !== null ? { ...json, width, height } : json;
}
