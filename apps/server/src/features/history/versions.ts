// Versions (Page history and Trash spec, section 3.1): automatic ones after a stretch of edits
// (HT-01), and ones saved right before something replaces the content (HT-02).
import { createHash } from 'node:crypto';
import {
  VERSION_MAX_STRETCH_MS,
  VERSION_PAUSE_MS,
  countChanges,
  diffDocs,
  isVersionReason,
  kindForReason,
  type HistoryDoc,
  type VersionKind,
  type VersionReason,
} from '@carehub/extras/history';
import { and, desc, eq, isNotNull, lte, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { historyContent } from './content';
import { hasPageModel, historyPages, type HistoryPage } from './pages';
import { historyEdits, historyVersions } from './schema';
import { recordUpdates } from './updates';

export interface SaveVersionOptions {
  /** What is about to replace the page's content. */
  reason: VersionReason;
  /** The person doing it; null for automations. */
  by: string | null;
}

export interface SavedVersion {
  id: string;
  pageId: string;
  kind: VersionKind;
  createdAt: Date;
}

type Edits = typeof historyEdits.$inferSelect;

/** Whether the page's unsaved edits are due for an automatic version at `now`. */
export function isDue(edits: Pick<Edits, 'firstAt' | 'lastAt'>, now: Date): boolean {
  if (!edits.firstAt || !edits.lastAt) return false;
  return (
    edits.lastAt.getTime() <= now.getTime() - VERSION_PAUSE_MS ||
    edits.firstAt.getTime() <= now.getTime() - VERSION_MAX_STRETCH_MS
  );
}

// An edit adds to the page's open stretch: earliest first edit, latest last edit, new editors at
// the end. Edits at or before the settled time are in a version already.
const mergeEdits = {
  firstAt: sql`LEAST(${historyEdits.firstAt}, excluded.first_at)`,
  lastAt: sql`GREATEST(${historyEdits.lastAt}, excluded.last_at)`,
  editorIds: sql`${historyEdits.editorIds} || ARRAY(
    SELECT unnest(excluded.editor_ids) EXCEPT SELECT unnest(${historyEdits.editorIds}))`,
};
const notSettled = sql`${historyEdits.settledAt} IS NULL
  OR ${historyEdits.settledAt} < excluded.last_at`;

/** Notes that people edited the page at `at` (one save of the collaboration server). */
export async function recordEdit(
  db: Db | Tx,
  pageId: string,
  userIds: readonly string[],
  at: Date,
): Promise<void> {
  const editorIds = [...new Set(userIds)];
  await db
    .insert(historyEdits)
    .values({ pageId, firstAt: at, lastAt: at, editorIds })
    .onConflictDoUpdate({ target: historyEdits.pageId, set: mergeEdits, setWhere: notSettled });
}

/**
 * stand-in: until the event page.contentSaved (#200) is on main, the collaboration server's saves
 * are read from page_docs: each save in the last 30 seconds that's newer than what's recorded
 * counts as an edit by the person who saved it.
 */
export async function recordSavedEdits(db: Db): Promise<void> {
  await db.execute(sql`
    INSERT INTO history_edits AS e (page_id, first_at, last_at, editor_ids)
    SELECT page_id, updated_at, updated_at,
      CASE WHEN updated_by IS NULL THEN '{}'::uuid[] ELSE ARRAY[updated_by] END
    FROM page_docs
    WHERE updated_at > now() - interval '30 seconds'
    ON CONFLICT (page_id) DO UPDATE SET
      first_at = LEAST(e.first_at, excluded.first_at),
      last_at = GREATEST(e.last_at, excluded.last_at),
      editor_ids = e.editor_ids || ARRAY(
        SELECT unnest(excluded.editor_ids) EXCEPT SELECT unnest(e.editor_ids))
    WHERE (e.settled_at IS NULL OR e.settled_at < excluded.last_at)
      AND (e.last_at IS NULL OR e.last_at < excluded.last_at)`);
}

/**
 * Closes the page's stretch of edits: saves up to `at` are in a version now (or, after a restore,
 * were the history's own write) and don't start a new one.
 */
export async function settleEdits(db: Db | Tx, pageId: string, at: Date): Promise<void> {
  await db
    .update(historyEdits)
    .set({
      firstAt: null,
      lastAt: null,
      editorIds: [],
      settledAt: sql`GREATEST(${historyEdits.settledAt}, ${at.toISOString()}::timestamptz)`,
    })
    .where(eq(historyEdits.pageId, pageId));
}

/**
 * The page's unsaved edits, locked until the transaction ends (null with skipLocked, when another
 * transaction holds them). The lock also keeps naming and restoring one at a time per page.
 */
export async function lockEdits(tx: Tx, pageId: string, skipLocked = false): Promise<Edits | null> {
  await tx.insert(historyEdits).values({ pageId }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(historyEdits)
    .where(eq(historyEdits.pageId, pageId))
    .for('update', skipLocked ? { skipLocked: true } : {});
  return row ?? null;
}

/** Pages in Trash, missing pages and databases have no versions. */
function canHaveVersions(page: HistoryPage | null): page is HistoryPage {
  return page !== null && !page.trashed && page.kind !== 'database';
}

interface Snapshot {
  workspaceId: string;
  title: string;
  icon: unknown;
  cover: unknown;
  style: Record<string, unknown>;
  content: HistoryDoc;
  digest: string;
  size: number;
}

/** The page as it is now: title, icon, cover, page style and content. */
async function takeSnapshot(db: Db | Tx, page: HistoryPage): Promise<Snapshot | null> {
  const source = historyContent();
  if (!source) return null;
  const copy = {
    title: page.title,
    icon: page.icon ?? null,
    cover: page.cover ?? null,
    style: page.style,
    content: await source.getPageContent(db, page.id),
  };
  const json = JSON.stringify(copy);
  return {
    workspaceId: page.workspaceId,
    ...copy,
    digest: createHash('sha256').update(json).digest('hex'),
    size: Buffer.byteLength(json),
  };
}

/**
 * Saves the version, with an "edited" entry in Updates for each person whose edits it holds
 * (HT-08): "Sam Ortiz edited · 3 changes", counted as Show changes marks them.
 */
async function insertVersion(
  tx: Tx,
  pageId: string,
  snapshot: Snapshot,
  fields: { kind: VersionKind; editorIds: string[]; createdBy: string | null; createdAt: Date },
): Promise<SavedVersion> {
  const [previous] = fields.editorIds.length
    ? await tx
        .select({ content: historyVersions.content })
        .from(historyVersions)
        .where(eq(historyVersions.pageId, pageId))
        .orderBy(desc(historyVersions.createdAt), desc(historyVersions.id))
        .limit(1)
    : [];
  const [row] = await tx
    .insert(historyVersions)
    .values({ pageId, ...snapshot, ...fields })
    .returning({ id: historyVersions.id, createdAt: historyVersions.createdAt });
  if (!row) throw new Error('The version was not saved.');
  // The first version has nothing to compare with, so its entries don't count changes.
  const details = previous
    ? { changes: countChanges(diffDocs(previous.content, snapshot.content)) }
    : {};
  await recordUpdates(
    tx,
    fields.editorIds.map((by) => ({
      pageId,
      workspaceId: snapshot.workspaceId,
      kind: 'edited' as const,
      by,
      details,
      versionId: row.id,
      at: row.createdAt,
    })),
  );
  return { id: row.id, pageId, kind: fields.kind, createdAt: row.createdAt };
}

async function newestVersion(tx: Tx, pageId: string) {
  const [row] = await tx
    .select({
      id: historyVersions.id,
      kind: historyVersions.kind,
      createdAt: historyVersions.createdAt,
      digest: historyVersions.digest,
    })
    .from(historyVersions)
    .where(eq(historyVersions.pageId, pageId))
    .orderBy(desc(historyVersions.createdAt), desc(historyVersions.id))
    .limit(1);
  return row ?? null;
}

/**
 * Saves a version of the page right away, before `reason` replaces its content (HT-02). Call it
 * in the transaction that changes the page, before the change: a rollback drops the version too.
 * The version covers the edits that aren't in one yet, so no automatic version follows for them.
 * Returns null when the page has no versions (missing, in Trash, a database).
 */
export function saveVersionNow(
  tx: Db | Tx,
  pageId: string,
  options: SaveVersionOptions,
): Promise<SavedVersion | null> {
  return saveBeforeVersion(tx, pageId, { reason: options.reason, by: options.by });
}

/**
 * saveVersionNow, and with `skipIfUnchanged` (versions the editor asks for) no new version when
 * nothing changed since the newest one, which is returned instead.
 */
export async function saveBeforeVersion(
  tx: Db | Tx,
  pageId: string,
  options: SaveVersionOptions & { skipIfUnchanged?: boolean },
): Promise<SavedVersion | null> {
  if (!isVersionReason(options.reason)) throw new TypeError('Unknown version reason.');
  // stand-in: without the page model and the content API (#49, #200) there's nothing to copy.
  if (!hasPageModel() || !historyContent()) return null;
  const page = await historyPages().getPage(tx, pageId);
  if (!canHaveVersions(page)) return null;
  const reason = options.reason;
  return (tx as Db).transaction(async (inner) => {
    const edits = await lockEdits(inner, pageId);
    const snapshot = await takeSnapshot(inner, page);
    if (!snapshot) return null;
    const now = new Date();
    const newest = options.skipIfUnchanged ? await newestVersion(inner, pageId) : null;
    if (newest && newest.digest === snapshot.digest) {
      await settleEdits(inner, pageId, now);
      return { id: newest.id, pageId, kind: newest.kind, createdAt: newest.createdAt };
    }
    const version = await insertVersion(inner, pageId, snapshot, {
      kind: kindForReason(reason),
      editorIds: edits?.editorIds ?? [],
      createdBy: options.by,
      createdAt: now,
    });
    await settleEdits(inner, pageId, now);
    return version;
  });
}

/** Saves the page's automatic version if its edits are due, unless another save holds the page. */
async function saveAutomaticVersion(
  db: Db,
  pageId: string,
  now: Date,
): Promise<SavedVersion | null> {
  return db.transaction(async (tx) => {
    const edits = await lockEdits(tx, pageId, true);
    if (!edits || !isDue(edits, now)) return null;
    const page = await historyPages().getPage(tx, pageId);
    const snapshot = canHaveVersions(page) ? await takeSnapshot(tx, page) : null;
    let version: SavedVersion | null = null;
    // A stretch that ends where the last version did (typed, then undone) isn't kept twice.
    if (snapshot && snapshot.digest !== (await newestVersion(tx, pageId))?.digest) {
      version = await insertVersion(tx, pageId, snapshot, {
        kind: 'automatic',
        editorIds: edits.editorIds,
        createdBy: null,
        createdAt: now,
      });
    }
    await settleEdits(tx, pageId, now);
    return version;
  });
}

/** Saves an automatic version for every page whose edits are due at `now` (HT-01). */
export async function saveDueVersions(
  db: Db,
  now = new Date(),
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<SavedVersion[]> {
  // stand-in: with no page model there's nothing to save, so other features' tests see no queries.
  if (!hasPageModel() || !historyContent()) return [];
  const pauseEnded = new Date(now.getTime() - VERSION_PAUSE_MS);
  const stretchEnded = new Date(now.getTime() - VERSION_MAX_STRETCH_MS);
  const due = await db
    .select({ pageId: historyEdits.pageId })
    .from(historyEdits)
    .where(
      and(
        isNotNull(historyEdits.firstAt),
        or(lte(historyEdits.lastAt, pauseEnded), lte(historyEdits.firstAt, stretchEnded)),
      ),
    )
    .orderBy(historyEdits.lastAt)
    .limit(options.limit ?? 100);
  const saved: SavedVersion[] = [];
  for (const { pageId } of due) {
    if (options.signal?.aborted) break;
    const version = await saveAutomaticVersion(db, pageId, now);
    if (version) saved.push(version);
  }
  return saved;
}

/** Removes everything history keeps for pages deleted for good (HT-11). */
export async function forgetPages(db: Db | Tx, pageIds: readonly string[]): Promise<void> {
  if (pageIds.length === 0) return;
  const ids = sql`${sql.param([...pageIds])}::uuid[]`;
  await db.execute(sql`DELETE FROM history_versions WHERE page_id = ANY(${ids})`);
  await db.execute(sql`DELETE FROM history_edits WHERE page_id = ANY(${ids})`);
  await db.execute(sql`DELETE FROM history_updates WHERE page_id = ANY(${ids})`);
}
