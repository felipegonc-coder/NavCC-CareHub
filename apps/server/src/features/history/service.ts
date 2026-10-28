// Reading, naming and restoring versions for the routes (Page history and Trash spec, 3.1 and 3.2).
import {
  MAX_NAMED_VERSIONS,
  type HistoryPerson,
  type VersionPage,
  type VersionSummary,
} from '@carehub/extras/history';
import { and, count, desc, eq, inArray, isNotNull, lt, or, type SQL } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { users } from '../auth/schema';
import { assertCanChange } from './access';
import { historyContent } from './content';
import { historyPages, type HistoryPage } from './pages';
import { historyVersions } from './schema';
import { lockEdits, saveVersionNow, settleEdits } from './versions';

/** What the "Version can't open" state says (and the answer for a version that never was). */
export const TOO_OLD = 'This version is too old to show (deleted under the Data settings period).';

type VersionRow = typeof historyVersions.$inferSelect;
type SummaryRow = Pick<
  VersionRow,
  'id' | 'kind' | 'name' | 'createdAt' | 'editorIds' | 'createdBy' | 'restoredFrom'
>;

const summaryColumns = {
  id: historyVersions.id,
  kind: historyVersions.kind,
  name: historyVersions.name,
  createdAt: historyVersions.createdAt,
  editorIds: historyVersions.editorIds,
  createdBy: historyVersions.createdBy,
  restoredFrom: historyVersions.restoredFrom,
};

async function peopleFor(db: Db | Tx, ids: readonly string[]): Promise<Map<string, HistoryPerson>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((row) => [row.id, row]));
}

/** Versions as the API shows them, with people's names. */
export async function summarize(
  db: Db | Tx,
  rows: readonly SummaryRow[],
): Promise<VersionSummary[]> {
  const people = await peopleFor(
    db,
    rows.flatMap((row) => (row.createdBy ? [...row.editorIds, row.createdBy] : row.editorIds)),
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    editors: row.editorIds.flatMap((id) => people.get(id) ?? []),
    createdBy: (row.createdBy && people.get(row.createdBy)) || null,
    restoredFrom: row.restoredFrom?.toISOString() ?? null,
  }));
}

function pageOf(row: VersionRow): VersionPage {
  return {
    title: row.title,
    icon: row.icon,
    cover: row.cover,
    style: row.style,
    content: row.content,
  };
}

/** Versions saved before this one, newest first (same time: by ID). */
function olderThan(at: Date, id: string): SQL | undefined {
  return or(
    lt(historyVersions.createdAt, at),
    and(eq(historyVersions.createdAt, at), lt(historyVersions.id, id)),
  );
}

const newestFirst = [desc(historyVersions.createdAt), desc(historyVersions.id)];

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}~${row.id}`;
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const [at = '', id = ''] = cursor.split('~');
  return { at: new Date(at), id };
}

export async function listVersions(
  db: Db | Tx,
  pageId: string,
  options: { before?: string; limit: number },
): Promise<{ versions: VersionSummary[]; nextCursor: string | null }> {
  const cursor = options.before ? decodeCursor(options.before) : null;
  const rows = await db
    .select(summaryColumns)
    .from(historyVersions)
    .where(
      and(eq(historyVersions.pageId, pageId), cursor ? olderThan(cursor.at, cursor.id) : undefined),
    )
    .orderBy(...newestFirst)
    .limit(options.limit + 1);
  const shown = rows.slice(0, options.limit);
  const last = shown[shown.length - 1];
  return {
    versions: await summarize(db, shown),
    nextCursor: rows.length > options.limit && last ? encodeCursor(last) : null,
  };
}

async function versionRow(db: Db | Tx, pageId: string, versionId: string): Promise<VersionRow> {
  const [row] = await db
    .select()
    .from(historyVersions)
    .where(and(eq(historyVersions.id, versionId), eq(historyVersions.pageId, pageId)));
  if (!row) throw httpError(404, 'not_found', TOO_OLD);
  return row;
}

/** One version as the list shows it. */
export async function versionSummary(
  db: Db | Tx,
  pageId: string,
  versionId: string,
): Promise<VersionSummary> {
  const rows = await db
    .select(summaryColumns)
    .from(historyVersions)
    .where(and(eq(historyVersions.id, versionId), eq(historyVersions.pageId, pageId)));
  const [summary] = await summarize(db, rows);
  if (!summary) throw httpError(404, 'not_found', TOO_OLD);
  return summary;
}

/** A version with what it holds, and the one before it for Show changes. */
export async function getVersion(db: Db | Tx, pageId: string, versionId: string) {
  const row = await versionRow(db, pageId, versionId);
  const [before] = await db
    .select()
    .from(historyVersions)
    .where(and(eq(historyVersions.pageId, pageId), olderThan(row.createdAt, row.id)))
    .orderBy(...newestFirst)
    .limit(1);
  const [version, previous] = await summarize(db, before ? [row, before] : [row]);
  return {
    version: version!,
    page: pageOf(row),
    previous: before && previous ? { version: previous, page: pageOf(before) } : null,
  };
}

/** Names, renames or (null) un-names a version; up to 100 named versions per page. */
export async function nameVersion(
  db: Db,
  pageId: string,
  versionId: string,
  name: string | null,
  by: string,
): Promise<VersionSummary> {
  return db.transaction(async (tx) => {
    await lockEdits(tx, pageId);
    const row = await versionRow(tx, pageId, versionId);
    if (name !== null && row.name === null) {
      const [named] = await tx
        .select({ count: count() })
        .from(historyVersions)
        .where(and(eq(historyVersions.pageId, pageId), isNotNull(historyVersions.name)));
      if ((named?.count ?? 0) >= MAX_NAMED_VERSIONS) {
        throw httpError(
          409,
          'conflict',
          `This page has ${MAX_NAMED_VERSIONS} named versions. Remove a name first.`,
        );
      }
    }
    const [updated] = await tx
      .update(historyVersions)
      .set({ name, namedBy: name ? by : null, namedAt: name ? new Date() : null })
      .where(eq(historyVersions.id, versionId))
      .returning(summaryColumns);
    const [summary] = await summarize(tx, updated ? [updated] : []);
    if (!summary) throw httpError(404, 'not_found', TOO_OLD);
    return summary;
  });
}

export interface Restored {
  /** The version saved just before the restore (it has the restorer and `restoredFrom`). */
  saved: VersionSummary;
  restoredVersionId: string;
}

/**
 * Restores a version (HT-05, HT-06): saves the page as it is now (unsaved edits included), then
 * puts back the version's content, title, icon, cover and page style, as one change. Other pages
 * are never restored or deleted.
 */
export async function restoreVersion(
  db: Db,
  page: HistoryPage,
  versionId: string,
  by: string,
): Promise<Restored> {
  const content = historyContent();
  if (!content) throw httpError(404, 'not_found');
  return db.transaction(async (tx) => {
    // Checked again inside the transaction, in case the page was locked or archived meanwhile.
    const current = await historyPages().getPage(tx, page.id);
    if (!current || current.trashed) throw httpError(404, 'not_found');
    assertCanChange(current);
    const row = await versionRow(tx, page.id, versionId);
    const before = await saveVersionNow(tx, page.id, { reason: 'restore', by });
    if (!before) throw httpError(404, 'not_found');
    await content.setPageContent(tx, page.id, row.content, by);
    const { title, icon, cover, style } = row;
    await historyPages().setPageLook(tx, page.id, { title, icon, cover, style }, by);
    // The restore's own write isn't an edit: no automatic version follows for it.
    await settleEdits(tx, page.id, new Date());
    const [marked] = await tx
      .update(historyVersions)
      .set({ restoredVersionId: row.id, restoredFrom: row.createdAt })
      .where(eq(historyVersions.id, before.id))
      .returning(summaryColumns);
    const [saved] = await summarize(tx, marked ? [marked] : []);
    if (!saved) throw new Error('The version saved before the restore is missing.');
    return { saved, restoredVersionId: row.id };
  });
}
