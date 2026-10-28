// How long unnamed versions are kept, and the nightly clean-up (HT-03; Data settings, DS-01).
// Named versions are kept until someone removes their name.
import { DEFAULT_VERSION_RETENTION_DAYS, versionRetentionSchema } from '@carehub/extras/history';
import { and, count, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { historyVersions } from './schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 1000;

type SettingLookup = (db: Db | Tx, workspaceId: string) => Promise<unknown>;

// stand-in: getWorkspaceSetting(db, workspaceId, 'history.versionRetentionDays') from
// features/workspaces/index.ts (accounts 1c). Until then every workspace keeps the default.
const unset: SettingLookup = async () => undefined;
let setting = unset;

/** Binds the workspace setting; the returned function unbinds it. */
export function bindRetentionSetting(next: SettingLookup): () => void {
  setting = next;
  return () => {
    if (setting === next) setting = unset;
  };
}

/** Days unnamed versions are kept in the workspace; null keeps them forever. */
export async function versionRetentionDays(
  db: Db | Tx,
  workspaceId: string,
): Promise<number | null> {
  const value = await setting(db, workspaceId);
  const parsed = versionRetentionSchema.safeParse(value);
  return value !== undefined && parsed.success ? parsed.data : DEFAULT_VERSION_RETENTION_DAYS;
}

const cutoff = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

/**
 * How many unnamed versions in the workspace are older than `days`: what shortening the period
 * deletes that night (Data settings shows it first).
 */
export async function countExpiringVersions(
  db: Db | Tx,
  workspaceId: string,
  days: number,
  now = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(historyVersions)
    .where(
      and(
        eq(historyVersions.workspaceId, workspaceId),
        isNull(historyVersions.name),
        lt(historyVersions.createdAt, cutoff(now, days)),
      ),
    );
  return row?.count ?? 0;
}

/** Bytes the workspace's versions take, for the storage numbers in Data settings. */
export async function versionStorageBytes(db: Db | Tx, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ bytes: sql<string>`coalesce(sum(${historyVersions.size}), 0)` })
    .from(historyVersions)
    .where(eq(historyVersions.workspaceId, workspaceId));
  return Number(row?.bytes ?? 0);
}

export interface CleanedVersions {
  workspaceId: string;
  deleted: number;
}

/** Deletes unnamed versions older than each workspace's period, a batch at a time. */
export async function deleteExpiredVersions(
  db: Db,
  now = new Date(),
  signal?: AbortSignal,
): Promise<CleanedVersions[]> {
  const workspaces = await db
    .selectDistinct({ workspaceId: historyVersions.workspaceId })
    .from(historyVersions)
    .where(isNull(historyVersions.name));
  const cleaned: CleanedVersions[] = [];
  for (const { workspaceId } of workspaces) {
    if (signal?.aborted) break;
    const days = await versionRetentionDays(db, workspaceId);
    if (days === null) continue;
    const before = cutoff(now, days).toISOString();
    let deleted = 0;
    for (;;) {
      const result = await db.execute(sql`
        DELETE FROM history_versions WHERE id IN (
          SELECT id FROM history_versions
          WHERE workspace_id = ${workspaceId} AND name IS NULL
            AND created_at < ${before}::timestamptz
          LIMIT ${BATCH})`);
      const removed = result.rowCount ?? 0;
      deleted += removed;
      if (removed < BATCH || signal?.aborted) break;
    }
    if (deleted > 0) cleaned.push({ workspaceId, deleted });
  }
  return cleaned;
}

// stand-in: the workspace's time zone (workspaces 1c). Until then the night is Denver's.
const NIGHT_TIME_ZONE = 'America/Denver';
const CLEANUP_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((one) => one.type === type)?.value ?? 0);
  return { hour: part('hour'), minute: part('minute'), second: part('second') };
}

/** The clean-up runs in the 3 AM hour, once a night. */
export function isCleanupHour(now: Date, timeZone = NIGHT_TIME_ZONE): boolean {
  return localParts(now, timeZone).hour === CLEANUP_HOUR;
}

/** The start of the local hour `now` is in: the clean-up counts ages from 3:00 sharp. */
export function hourStart(now: Date, timeZone = NIGHT_TIME_ZONE): Date {
  const { minute, second } = localParts(now, timeZone);
  return new Date(now.getTime() - (minute * 60 + second) * 1000 - now.getMilliseconds());
}

/**
 * When the next clean-up counts from. Pass it to `countExpiringVersions` and the count is exactly
 * what that night deletes (DS-01).
 */
export function nextCleanupAt(now = new Date(), timeZone = NIGHT_TIME_ZONE): Date {
  let at = hourStart(now, timeZone);
  for (let hours = 0; hours < 48; hours += 1) {
    at = new Date(at.getTime() + HOUR_MS);
    if (isCleanupHour(at, timeZone)) return at;
  }
  return at;
}
