import type { ClaudeFeature } from '@carehub/extras/claude';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { claudeUsage, type ClaudeUsageStatus } from '../schema';

/** The monthly cap starts again on the 1st at midnight in this time zone. */
export const CAP_TIME_ZONE = 'America/Denver';

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
