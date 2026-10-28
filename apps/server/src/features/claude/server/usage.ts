import type { ClaudeFeature } from '@carehub/extras/claude';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { claudeUsage, type ClaudeUsageStatus } from '../schema';

/** The monthly cap starts again on the 1st at midnight in this time zone. */
export const CAP_TIME_ZONE = 'America/Denver';
/**
 * A reserved request waits on Claude until it ends, or for at most this long if the server stopped
 * before it could say how it ended. Longer than the client's longest try: 3 tries of at most 30 s,
 * with 2 waits of at most 10 s. The request still counts toward the caps after.
 */
export const IN_FLIGHT_MS = 3 * 60_000;
/** The first number of every Claude advisory lock: "CLAU" in ASCII. */
const CLAUDE_LOCKS = 0x434c4155;

export interface UsageRow {
  workspaceId: string;
  userId: string;
  feature: ClaudeFeature;
  status: ClaudeUsageStatus;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: Date;
}

export async function recordUsage(db: Db | Tx, row: UsageRow): Promise<void> {
  await db.insert(claudeUsage).values(row);
}

/**
 * Runs `reserve` in a transaction of its own on `db`, holding a Postgres advisory lock for each key
 * in turn, so two requests can't both pass a cap and send. Give the keys in the same order every
 * time (the workspace, then the person) and run every query on `tx`. The locks end with the
 * transaction.
 */
export async function withClaudeLocks<T>(
  db: Db,
  keys: readonly string[],
  reserve: (tx: Tx) => Promise<T>,
): Promise<T> {
  // Read committed: each query after the locks sees what the last holder committed.
  return db.transaction(
    async (tx) => {
      for (const key of keys) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${CLAUDE_LOCKS}::int, hashtext(${key}::text))`,
        );
      }
      return reserve(tx);
    },
    { isolationLevel: 'read committed' },
  );
}

/** Counts a request from before it's sent: a `pending` row that finishUsage completes. */
export async function reserveUsage(tx: Tx, row: Omit<UsageRow, 'status'>): Promise<string> {
  const [reserved] = await tx
    .insert(claudeUsage)
    .values({ ...row, status: 'pending', inputTokens: 0, outputTokens: 0 })
    .returning({ id: claudeUsage.id });
  if (!reserved) throw new Error('claude_usage: the reserved row was not returned');
  return reserved.id;
}

export interface UsageResult {
  status: Exclude<ClaudeUsageStatus, 'pending'>;
  /** Only what Anthropic reported; 0 when the request failed without an answer. */
  inputTokens?: number;
  outputTokens?: number;
}

/** Writes how a reserved request ended over its `pending` row. */
export async function finishUsage(db: Db | Tx, id: string, result: UsageResult): Promise<void> {
  await db
    .update(claudeUsage)
    .set({
      status: result.status,
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
    })
    .where(eq(claudeUsage.id, id));
}

/** The person's requests still waiting on Claude, in any workspace. */
export async function requestsInFlight(db: Db | Tx, userId: string, now: Date) {
  const since = new Date(now.getTime() - IN_FLIGHT_MS);
  const [row] = await db
    .select({ n: count() })
    .from(claudeUsage)
    .where(
      and(
        eq(claudeUsage.userId, userId),
        eq(claudeUsage.status, 'pending'),
        gte(claudeUsage.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

const monthStart = (now: Date) =>
  sql`date_trunc('month', ${now.toISOString()}::timestamptz AT TIME ZONE ${CAP_TIME_ZONE}::text) AT TIME ZONE ${CAP_TIME_ZONE}::text`;

/** Requests the workspace has sent this calendar month. */
export async function requestsThisMonth(db: Db | Tx, workspaceId: string, now: Date) {
  const [row] = await db
    .select({ n: count() })
    .from(claudeUsage)
    .where(
      and(
        eq(claudeUsage.workspaceId, workspaceId),
        sql`${claudeUsage.createdAt} >= ${monthStart(now)}`,
      ),
    );
  return row?.n ?? 0;
}

/** This calendar month's requests per feature, for Settings → Claude. */
export async function requestsThisMonthByFeature(
  db: Db | Tx,
  workspaceId: string,
  now: Date,
): Promise<Map<ClaudeFeature, number>> {
  const rows = await db
    .select({ feature: claudeUsage.feature, n: count() })
    .from(claudeUsage)
    .where(
      and(
        eq(claudeUsage.workspaceId, workspaceId),
        sql`${claudeUsage.createdAt} >= ${monthStart(now)}`,
      ),
    )
    .groupBy(claudeUsage.feature);
  return new Map(rows.map((row) => [row.feature, row.n]));
}

/** The calendar month in CAP_TIME_ZONE, as YYYY-MM. */
export function capMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}`;
}

/** Requests the person has sent since `since`, in any workspace. */
export async function requestsSince(db: Db | Tx, userId: string, since: Date) {
  const [row] = await db
    .select({ n: count() })
    .from(claudeUsage)
    .where(and(eq(claudeUsage.userId, userId), gte(claudeUsage.createdAt, since)));
  return row?.n ?? 0;
}
