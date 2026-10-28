import { stoppedMessage, type ImportStatus } from '@carehub/extras/import-export/import/index';
import { and, asc, count, desc, eq, gte, inArray, lt, notInArray } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { ieImportItems, ieImportUploads, ieImports, type ItemKind } from './schema';

// Reads and writes of the import tables (schema.ts). Every status change names the statuses it
// may start from, so the job, Cancel and Undo never both win.

export type ImportRow = typeof ieImports.$inferSelect;
export type NewImport = typeof ieImports.$inferInsert;
export type ImportChanges = Partial<Omit<NewImport, 'id' | 'workspaceId' | 'userId'>>;

/** A page, database or row an import made, under another one or at the destination (null). */
export interface ImportItem {
  pageId: string;
  parentId: string | null;
  kind: ItemKind;
  title: string;
}

/** Imports that haven't ended: they can still be cancelled. */
export const OPEN_STATUSES = [
  'uploading',
  'waiting',
  'running',
] as const satisfies readonly ImportStatus[];

/** Statuses the job may pick an import up in (`running` again after a restart). */
export const RUNNABLE_STATUSES = ['waiting', 'running'] as const satisfies readonly ImportStatus[];

export async function insertImport(db: Db | Tx, values: NewImport): Promise<ImportRow> {
  const [row] = await db.insert(ieImports).values(values).returning();
  if (!row) throw new Error('The import was not saved.');
  return row;
}

export async function findImport(db: Db | Tx, id: string): Promise<ImportRow | null> {
  const [row] = await db.select().from(ieImports).where(eq(ieImports.id, id));
  return row ?? null;
}

/** The person's imports since `since`, newest first. */
export function listImports(
  db: Db | Tx,
  userId: string,
  since: Date,
  limit: number,
): Promise<ImportRow[]> {
  return db
    .select()
    .from(ieImports)
    .where(and(eq(ieImports.userId, userId), gte(ieImports.createdAt, since)))
    .orderBy(desc(ieImports.createdAt))
    .limit(limit);
}

export async function countOpenImports(db: Db | Tx, userId: string): Promise<number> {
  const [row] = await db
    .select({ open: count() })
    .from(ieImports)
    .where(and(eq(ieImports.userId, userId), inArray(ieImports.status, [...OPEN_STATUSES])));
  return row?.open ?? 0;
}

/** Changes an import that is in one of `from`; null when it isn't (any more). */
export async function moveImport(
  db: Db | Tx,
  id: string,
  from: readonly ImportStatus[],
  changes: ImportChanges,
): Promise<ImportRow | null> {
  const [row] = await db
    .update(ieImports)
    .set(changes)
    .where(and(eq(ieImports.id, id), inArray(ieImports.status, [...from])))
    .returning();
  return row ?? null;
}

// stand-in: the files service's storage (0007, section 4.3). Until then an upload waits in
// Postgres, and is deleted once the import ends.
export async function saveUpload(tx: Tx, importId: string, bytes: Uint8Array): Promise<void> {
  await tx.insert(ieImportUploads).values({ importId, bytes });
}

export async function loadUpload(db: Db | Tx, importId: string): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ bytes: ieImportUploads.bytes })
    .from(ieImportUploads)
    .where(eq(ieImportUploads.importId, importId));
  return row?.bytes ?? null;
}

export async function deleteUpload(db: Db | Tx, importId: string): Promise<void> {
  await db.delete(ieImportUploads).where(eq(ieImportUploads.importId, importId));
}

/** 1,000 items of 6 values stay well under Postgres' 65,535 parameters. */
const ITEMS_PER_INSERT = 1_000;

export async function saveItems(
  tx: Tx,
  importId: string,
  items: readonly ImportItem[],
): Promise<void> {
  for (let start = 0; start < items.length; start += ITEMS_PER_INSERT) {
    const values = items
      .slice(start, start + ITEMS_PER_INSERT)
      .map((item, index) => ({ importId, ...item, position: start + index }));
    await tx.insert(ieImportItems).values(values);
  }
}

/** What the import made, parents before what's under them. */
export function listItems(db: Db | Tx, importId: string): Promise<ImportItem[]> {
  return db
    .select({
      pageId: ieImportItems.pageId,
      parentId: ieImportItems.parentId,
      kind: ieImportItems.kind,
      title: ieImportItems.title,
    })
    .from(ieImportItems)
    .where(eq(ieImportItems.importId, importId))
    .orderBy(asc(ieImportItems.position));
}

/**
 * Clean-up: an upload that hasn't arrived by `before` stops the import, and uploads of imports
 * that ended (when the job couldn't delete them) go.
 */
export async function cleanUpUploads(db: Db, before: Date): Promise<void> {
  await db
    .update(ieImports)
    .set({
      status: 'failed',
      error: stoppedMessage("the file didn't finish uploading"),
      finishedAt: new Date(),
    })
    .where(and(eq(ieImports.status, 'uploading'), lt(ieImports.createdAt, before)));
  const waiting = db
    .select({ id: ieImports.id })
    .from(ieImports)
    .where(inArray(ieImports.status, [...RUNNABLE_STATUSES]));
  await db.delete(ieImportUploads).where(notInArray(ieImportUploads.importId, waiting));
}

/** Imports waiting or running since before `before`, for the clean-up to check on their jobs. */
export function staleImports(db: Db | Tx, before: Date, limit: number): Promise<ImportRow[]> {
  return db
    .select()
    .from(ieImports)
    .where(and(inArray(ieImports.status, [...RUNNABLE_STATUSES]), lt(ieImports.createdAt, before)))
    .orderBy(asc(ieImports.createdAt))
    .limit(limit);
}
