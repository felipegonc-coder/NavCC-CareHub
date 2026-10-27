import {
  CLAUDE_FIELD_LIMITS,
  claudeFieldFailureMessage,
  type ClaudeFieldFailure,
  type ClaudeFieldProgress,
} from '@carehub/extras/claude/fields';
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../../db';
import { sendNotice } from '../../notices';
import { claudeFieldQueue } from '../schema';
import { isClaudeFeatureOn } from './ask';
import { claudeErrorReason } from './errors';
import { checkField, fieldErrorReason, fillRow } from './fields';
import { claudeFieldHost } from './fields-host';
import { claudeRuntime } from './runtime';

/** A claimed row stays hidden from other runs this long, in case a run stops halfway. */
const LEASE_MS = 5 * 60_000;
/** How long a row waits after a limit said no, or after an unexpected error. */
const RETRY_MS = 60_000;
/** Tries for a row whose fill hit an unexpected error. */
const MAX_ATTEMPTS = 3;

const q = claudeFieldQueue;
type QueueEntry = typeof claudeFieldQueue.$inferSelect;

export interface ClaudeFieldRowChange {
  databaseId: string;
  rowId: string;
  /** The properties that changed; for a new row, those it starts with. */
  propertyIds: readonly string[];
  /** Whether the row page's content changed. */
  contentChanged?: boolean | undefined;
  /** As in Databases' row events. Imports never fill. */
  source: string;
}

/**
 * Queues an automatic fill of the row for each Automatically field that uses what changed, 2
 * minutes after the change. Each change moves it back, so a row being edited fills once.
 * stand-in: Databases' row events and the page content event (decision 0200) call this; never for
 * imports or duplicates.
 */
export async function claudeFieldRowChanged(db: Db, change: ClaudeFieldRowChange): Promise<void> {
  if (change.source === 'import') return;
  const fields = (await claudeFieldHost().autoFields(db, change.databaseId)).filter(
    ({ setup }) =>
      setup.fill === 'auto' &&
      (setup.uses.some((id) => change.propertyIds.includes(id)) ||
        (change.contentChanged === true && setup.usesPageContent)),
  );
  const [first] = fields;
  // With Claude fields off, nothing fills automatically.
  if (!first || !(await isClaudeFeatureOn(db, first.workspaceId, 'fields'))) return;
  const dueAt = new Date(claudeRuntime().now().getTime() + CLAUDE_FIELD_LIMITS.autoDelayMs);
  await db
    .insert(q)
    .values(
      fields.map((field) => ({
        workspaceId: field.workspaceId,
        databaseId: field.databaseId,
        propertyId: field.propertyId,
        rowId: change.rowId,
        auto: true,
        dueAt,
      })),
    )
    .onConflictDoUpdate({
      target: [q.databaseId, q.propertyId, q.rowId],
      set: {
        auto: true,
        requestedBy: null,
        dueAt,
        attempts: 0,
        version: sql`${q.version} + 1`,
        batchId: null,
        failedReason: null,
      },
      // A By-hand fill waiting goes first. One filling now (claimed, so due after dueAt) may have
      // read the row before this change: it finishes, then the row fills automatically again. So
      // does one that couldn't fill.
      setWhere: or(eq(q.auto, true), gt(q.dueAt, dueAt), isNotNull(q.failedReason)),
    });
}

/**
 * Fills the rows that are due, 5 at a time, until none is left, `signal` aborts or `budgetMs` has
 * passed, then sends the notices for batches that are done. The 'claude.fields' periodic task runs
 * it. Returns how many rows it took.
 */
export async function runClaudeFieldQueue(
  db: Db,
  options: { signal?: AbortSignal | undefined; budgetMs?: number } = {},
): Promise<number> {
  const stopAt = Date.now() + (options.budgetMs ?? 60_000);
  let taken = 0;
  while (!options.signal?.aborted && Date.now() < stopAt) {
    const batch = await claim(db);
    if (batch.length === 0) break;
    await Promise.all(batch.map((entry) => runEntry(db, entry)));
    taken += batch.length;
  }
  await notifyFailures(db);
  return taken;
}

async function claim(db: Db): Promise<QueueEntry[]> {
  const now = claudeRuntime().now();
  return db.transaction(async (tx) => {
    const due: QueueEntry[] = await tx
      .select()
      .from(q)
      .where(and(lte(q.dueAt, now), isNull(q.failedReason)))
      .orderBy(asc(q.dueAt))
      .limit(CLAUDE_FIELD_LIMITS.atOnce)
      .for('update', { skipLocked: true });
    if (due.length > 0) {
      await tx
        .update(q)
        .set({ dueAt: new Date(now.getTime() + LEASE_MS), attempts: sql`${q.attempts} + 1` })
        .where(
          inArray(
            q.id,
            due.map((entry) => entry.id),
          ),
        );
    }
    return due;
  });
}

type Outcome = 'done' | 'wait' | 'retry' | { failed: ClaudeFieldFailure };

async function runEntry(db: Db, entry: QueueEntry): Promise<void> {
  let outcome: Outcome;
  try {
    outcome = await fillEntry(db, entry);
  } catch {
    // Never the error itself: it could hold a row's text.
    claudeRuntime().log.warn(
      { claude: { status: 0, type: 'field_fill_failed' } },
      'A Claude field fill failed.',
    );
    // After the last try it counts as Claude not answering. The cell is left as it is.
    outcome = entry.attempts + 1 < MAX_ATTEMPTS ? 'retry' : { failed: 'unavailable' };
  }
  // A change since the row was claimed queued it again (a new version): that request stays.
  const same = and(eq(q.id, entry.id), eq(q.version, entry.version));
  if (outcome === 'done') {
    await db.delete(q).where(same);
    return;
  }
  if (typeof outcome === 'object') {
    // It stays until the rest of its batch is done, for the notice (notifyFailures).
    await db.update(q).set({ failedReason: outcome.failed }).where(same);
    return;
  }
  const dueAt = new Date(claudeRuntime().now().getTime() + RETRY_MS);
  // Waiting for a limit isn't a failed try.
  await db
    .update(q)
    .set(outcome === 'wait' ? { dueAt, attempts: entry.attempts } : { dueAt })
    .where(same);
}

/**
 * Fills one row as whoever it's for, checked again now. Nobody is waiting for the answer, so a
 * refusal or a failed request marks the cell with the reason, and the old text stays.
 */
async function fillEntry(db: Db, entry: QueueEntry): Promise<Exclude<Outcome, 'retry'>> {
  const host = claudeFieldHost();
  const field = await host.field(db, entry.databaseId, entry.propertyId);
  const userId = entry.auto ? field?.ownerId : entry.requestedBy;
  // A field that's gone, or that no longer fills automatically, has nothing left to fill.
  if (!field || !userId || (entry.auto && field.setup.fill !== 'auto')) return 'done';
  const { databaseId, propertyId } = field;
  const [rowId] = await host.fillableRows(db, {
    userId,
    databaseId,
    propertyId,
    rowIds: [entry.rowId],
    limit: 1,
  });
  // A row they can't edit any more, or that's gone, is left as it is.
  if (!rowId || rowId !== entry.rowId) return { failed: 'no_permission' };
  try {
    await checkField(db, field, userId);
    await fillRow(db, field, rowId, { userId, auto: entry.auto, background: true });
    return 'done';
  } catch (error) {
    const reason = claudeErrorReason(error) ?? fieldErrorReason(error);
    if (reason === 'user_rate_limit' || reason === 'database_hour') return 'wait';
    if (!reason || reason === 'rows_changed') throw error;
    await host.saveFill(db, { databaseId, propertyId, rowId, userId, value: null, reason });
    return { failed: reason };
  }
}

/**
 * Sends one notice for each batch that's done with rows that couldn't fill, then removes them. A
 * By-hand batch is one Fill, for the person who asked. A field's automatic fills are one batch
 * until none is waiting, for the field's owner.
 */
async function notifyFailures(db: Db): Promise<void> {
  const batches = await db
    .selectDistinct({ databaseId: q.databaseId, propertyId: q.propertyId, batchId: q.batchId })
    .from(q)
    .where(isNotNull(q.failedReason));
  for (const batch of batches) {
    const inBatch = and(
      eq(q.databaseId, batch.databaseId),
      eq(q.propertyId, batch.propertyId),
      batch.batchId === null ? isNull(q.batchId) : eq(q.batchId, batch.batchId),
    );
    const [waiting] = await db
      .select({ n: count() })
      .from(q)
      .where(and(inBatch, isNull(q.failedReason)));
    if ((waiting?.n ?? 0) > 0) continue;
    // Only one run gets the rows, so only one notice goes out.
    const failed = await db
      .delete(q)
      .where(and(inBatch, isNotNull(q.failedReason)))
      .returning({ reason: q.failedReason, requestedBy: q.requestedBy });
    if (failed.length > 0) await notify(db, batch, failed);
  }
}

async function notify(
  db: Db,
  batch: { databaseId: string; propertyId: string; batchId: string | null },
  failed: { reason: ClaudeFieldFailure | null; requestedBy: string | null }[],
): Promise<void> {
  const field = await claudeFieldHost().field(db, batch.databaseId, batch.propertyId);
  const userId = batch.batchId === null ? field?.ownerId : failed[0]?.requestedBy;
  if (!field || !userId) return;
  const counts = new Map<ClaudeFieldFailure, number>();
  for (const { reason } of failed) {
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const [reason] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['unavailable' as const];
  const one = failed.length === 1;
  const rows = one ? 'a row' : `${failed.length} rows`;
  const kept = one ? 'The row keeps its old text.' : 'The rows keep their old text.';
  const { pageId } = field;
  try {
    await sendNotice({
      workspaceId: field.workspaceId,
      userId,
      kind: 'alert',
      sender: 'Claude fields',
      title:
        batch.batchId === null
          ? `Claude couldn't fill ${rows} automatically`
          : `Claude couldn't fill ${rows} you asked for`,
      text: `${claudeFieldFailureMessage(reason)} ${kept}`,
      ...(pageId
        ? {
            card: { type: 'page' as const, pageId },
            buttons: [{ label: 'Open', href: `/p/${pageId}` }],
          }
        : {}),
      // Automatic batches close often: those a few minutes apart become one notice.
      groupKey: `claude.fields:${batch.batchId ?? `${batch.databaseId}:${batch.propertyId}`}`,
    });
  } catch {
    claudeRuntime().log.warn(
      { claude: { status: 0, type: 'field_notice_failed' } },
      "A Claude field notice wasn't sent.",
    );
  }
}

/** How many of the person's own By-hand rows of the field are still waiting (or filling). */
export async function claudeFieldProgress(
  db: Db,
  input: { userId: string; databaseId: string; propertyId: string },
): Promise<ClaudeFieldProgress> {
  const [row] = await db
    .select({ n: count() })
    .from(q)
    .where(
      and(
        eq(q.databaseId, input.databaseId),
        eq(q.propertyId, input.propertyId),
        eq(q.requestedBy, input.userId),
        isNull(q.failedReason),
      ),
    );
  return { waiting: row?.n ?? 0 };
}
