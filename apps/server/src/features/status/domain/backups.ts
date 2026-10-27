// Backup runs as the backup service records them (deploy/README.md, "Status page"): one JSON file
// per run in backups/runs/STAMP.json, where STAMP is the UTC start time, such as 20261027T080000Z.
import { z } from 'zod';
import { addDays, civilDate, zonedInstant } from './time';

/** File names in backups/runs/. */
export const RUN_FILE = /^\d{8}T\d{6}Z\.json$/;
/** BACKUP_AT: the daily backup time in TZ, such as 02:00. */
export const BACKUP_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const instant = z.iso.datetime();
const bytes = z.number().int().nonnegative();

/** One run file. The service writes null for anything it didn't get to. */
export const backupRunFileSchema = z.object({
  startedAt: instant.nullable(),
  finishedAt: instant.nullable(),
  ok: z.boolean(),
  dbBytes: bytes.nullable(),
  filesBytes: bytes.nullable(),
  restoreTest: z.object({
    ok: z.boolean(),
    checkedAt: instant.nullable(),
    details: z.string().nullable(),
  }),
});

export interface BackupRun {
  stamp: string;
  startedAt: Date;
  finishedAt: Date | null;
  /** The backup finished: dumped, archived and restore-tested. */
  ok: boolean;
  dbBytes: number | null;
  filesBytes: number | null;
  /** The restore test passed (it can pass on a run that failed afterwards). */
  restoreOk: boolean;
  /** When the restore test ended; null when it never started. */
  restoreCheckedAt: Date | null;
  /** The service's own words: what the restore test found, or what went wrong. */
  details: string | null;
}

export interface BackupSummary {
  /** The latest run that finished, or null if none has. */
  lastGood: { stamp: string; at: Date; sizeBytes: number | null } | null;
  /** The latest run, good or failed, or null when there are none yet ("No backups yet"). */
  latest: { stamp: string; at: Date; ok: boolean; reason: string | null } | null;
  /** The latest restore test that ran. */
  lastRestoreTest: { at: Date; ok: boolean; details: string | null } | null;
  /** When the next nightly backup is due. */
  next: Date;
}

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const NOT_RUN = 'Not run: ';
const FAILED = 'Failed: ';
const FAILED_AFTER = 'The backup failed afterwards: ';

/** The instant a stamp names, or null for one that isn't a real time (such as 20261332T000000Z). */
function stampTime(stamp: string): Date | null {
  const m = STAMP.exec(stamp);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  const at = new Date(iso);
  // Date rolls impossible dates over (February 30 becomes March 2), so check the round trip.
  return !Number.isNaN(at.getTime()) && at.toISOString() === iso.replace('Z', '.000Z') ? at : null;
}

/** Reads one run file. Null for anything else (a wrong name, broken or unexpected JSON). */
export function parseBackupRun(fileName: string, text: string): BackupRun | null {
  if (!RUN_FILE.test(fileName)) return null;
  const stamp = fileName.slice(0, -'.json'.length);
  const stampedAt = stampTime(stamp);
  if (!stampedAt) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = backupRunFileSchema.safeParse(json);
  if (!parsed.success) return null;
  const run = parsed.data;
  return {
    stamp,
    startedAt: run.startedAt ? new Date(run.startedAt) : stampedAt,
    finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
    ok: run.ok,
    dbBytes: run.dbBytes,
    filesBytes: run.filesBytes,
    restoreOk: run.restoreTest.ok,
    restoreCheckedAt: run.restoreTest.checkedAt ? new Date(run.restoreTest.checkedAt) : null,
    details: run.restoreTest.details,
  };
}

/** The size of a backup: the database dump and the files archive together. */
export function backupSize(run: Pick<BackupRun, 'dbBytes' | 'filesBytes'>): number | null {
  return run.dbBytes === null || run.filesBytes === null ? null : run.dbBytes + run.filesBytes;
}

/**
 * Why a run failed, in the service's words without its prefix or final period ("pg_dump failed").
 * Null for good runs and when the service gave no reason.
 */
export function failureReason(run: Pick<BackupRun, 'ok' | 'details'>): string | null {
  if (run.ok) return null;
  let reason = run.details?.trim() ?? '';
  const after = reason.indexOf(FAILED_AFTER);
  if (after >= 0) reason = reason.slice(after + FAILED_AFTER.length);
  else if (reason.startsWith(NOT_RUN)) reason = reason.slice(NOT_RUN.length);
  else if (reason.startsWith(FAILED)) reason = reason.slice(FAILED.length);
  return reason.trim().replace(/\.$/, '') || null;
}

/** What the restore test found, leaving out "The backup failed afterwards: …". */
export function restoreTestDetails(run: Pick<BackupRun, 'details'>): string | null {
  const details = run.details ?? '';
  const after = details.indexOf(FAILED_AFTER);
  return (after >= 0 ? details.slice(0, after) : details).trim() || null;
}

/** The first BACKUP_AT in `timeZone` after `now`. */
export function nextBackupAt(now: Date, backupAt: string, timeZone: string): Date {
  if (!BACKUP_TIME.test(backupAt)) throw new RangeError(`Not a backup time: ${backupAt}`);
  const today = civilDate(now.getTime(), timeZone);
  const todayAt = zonedInstant(today, backupAt, timeZone);
  if (todayAt > now.getTime()) return new Date(todayAt);
  return new Date(zonedInstant(addDays(today, 1), backupAt, timeZone));
}

function lastRestoreTest(newestFirst: readonly BackupRun[]): BackupSummary['lastRestoreTest'] {
  for (const run of newestFirst) {
    if (run.restoreCheckedAt) {
      return { at: run.restoreCheckedAt, ok: run.restoreOk, details: restoreTestDetails(run) };
    }
  }
  return null;
}

/** What the Status page shows about backups, from the recorded runs in any order. */
export function summarizeBackups(
  runs: readonly BackupRun[],
  schedule: { now: Date; backupAt: string; timeZone: string },
): BackupSummary {
  const newestFirst = runs.toSorted((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const latest = newestFirst[0];
  const good = newestFirst.find((run) => run.ok);
  return {
    lastGood: good ? { stamp: good.stamp, at: good.startedAt, sizeBytes: backupSize(good) } : null,
    latest: latest
      ? { stamp: latest.stamp, at: latest.startedAt, ok: latest.ok, reason: failureReason(latest) }
      : null,
    lastRestoreTest: lastRestoreTest(newestFirst),
    next: nextBackupAt(schedule.now, schedule.backupAt, schedule.timeZone),
  };
}
