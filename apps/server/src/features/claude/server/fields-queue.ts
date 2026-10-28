import { CLAUDE_FIELD_LIMITS, type ClaudeFieldProgress } from '@carehub/extras/claude/fields';
import { and, asc, count, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../../db';
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
      set: { auto: true, requestedBy: null, dueAt, attempts: 0, version: sql`${q.version} + 1` },
      // A By-hand fill waiting goes first. One filling now (claimed, so due after dueAt) may have read
      // the row before this change: it finishes, then the row fills automatically again.
      setWhere: or(eq(q.auto, true), gt(q.dueAt, dueAt)),
    });
}

/**
 * Fills the rows that are due, 5 at a time, until none is left, `signal` aborts or `budgetMs` has
 * passed. The 'claude.fields' periodic task runs it. Returns how many rows it took.
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
  return taken;
}

async function claim(db: Db): Promise<QueueEntry[]> {
  const now = claudeRuntime().now();
  return db.transaction(async (tx) => {
    const due: QueueEntry[] = await tx
      .select()
      .from(q)
      .where(lte(q.dueAt, now))
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

async function runEntry(db: Db, entry: QueueEntry): Promise<void> {
  let outcome: 'done' | 'wait' | 'retry';
  try {
    outcome = await fillEntry(db, entry);
  } catch {
    // Never the error itself: it could hold a row's text.
    claudeRuntime().log.warn(
      { claude: { status: 0, type: 'field_fill_failed' } },
      'A Claude field fill failed.',
    );
    outcome = entry.attempts + 1 < MAX_ATTEMPTS ? 'retry' : 'done';
  }
  // A change since the row was claimed queued it again (a new version): that request stays.
  const same = and(eq(q.id, entry.id), eq(q.version, entry.version));
  if (outcome === 'done') {
    await db.delete(q).where(same);
    return;
  }
  const dueAt = new Date(claudeRuntime().now().getTime() + RETRY_MS);
  // Waiting for a limit isn't a failed try.
  await db
    .update(q)
    .set(outcome === 'wait' ? { dueAt, attempts: entry.attempts } : { dueAt })
    .where(same);
}

/** Fills one row as whoever it's for, checked again now. Refusals and failed requests drop it. */
async function fillEntry(db: Db, entry: QueueEntry): Promise<'done' | 'wait'> {
  const host = claudeFieldHost();
  const field = await host.field(db, entry.databaseId, entry.propertyId);
  const userId = entry.auto ? field?.ownerId : entry.requestedBy;
  if (!field || !userId || (entry.auto && field.setup.fill !== 'auto')) return 'done';
  try {
    await checkField(db, field, userId);
    const [rowId] = await host.fillableRows(db, {
      userId,
      databaseId: field.databaseId,
      propertyId: field.propertyId,
      rowIds: [entry.rowId],
      limit: 1,
    });
    if (rowId && rowId === entry.rowId) {
      await fillRow(db, field, rowId, { userId, auto: entry.auto });
    }
    return 'done';
  } catch (error) {
    const reason = claudeErrorReason(error);
    if (reason === 'user_rate_limit' || fieldErrorReason(error) === 'database_hour') return 'wait';
    if (reason || fieldErrorReason(error)) return 'done';
    throw error;
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
      ),
    );
  return { waiting: row?.n ?? 0 };
}
