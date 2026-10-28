// What the Status page checks on disk: file storage, and the backup service's files
// (deploy/README.md, "Status page": runs/STAMP.json results, and requests/now to ask for a backup).
import { constants } from 'node:fs';
import { access, readFile, readdir, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RUN_FILE, parseBackupRun, type BackupRun } from './domain/backups';
import { fileStorageState } from './domain/overall';
import type { PartCheck } from './store';

/** The newest run files read; the backup service keeps about a month of them. */
const MAX_RUNS = 100;

/** File storage: down when files can't be written, a problem under 15% free disk space. */
export async function checkFileStorage(dir: string | undefined): Promise<PartCheck> {
  const check = (state: PartCheck['state'], message: string | null, facts = {}): PartCheck => ({
    part: 'files',
    state,
    message,
    facts,
  });
  if (!dir) return check('unknown', "FILES_DIR isn't set, so file storage isn't checked.");
  let writable = true;
  try {
    await access(dir, constants.W_OK);
  } catch {
    writable = false;
  }
  try {
    const disk = await statfs(dir);
    const facts = { freeBytes: disk.bavail * disk.bsize, totalBytes: disk.blocks * disk.bsize };
    const state = fileStorageState({ writable, ...facts });
    if (!writable) return check(state, "Care Hub can't write to the files folder.", facts);
    return check(state, state === 'problem' ? 'Less than 15% of the disk is free.' : null, facts);
  } catch {
    return check('down', "Care Hub can't find the files folder.");
  }
}

/** The recorded backup runs, or null when there's no runs folder (backups aren't set up). */
export async function readBackupRuns(backupsDir: string): Promise<BackupRun[] | null> {
  const runsDir = join(backupsDir, 'runs');
  let names: string[];
  try {
    names = await readdir(runsDir);
  } catch {
    return null;
  }
  const newest = names
    .filter((name) => RUN_FILE.test(name))
    .sort()
    .slice(-MAX_RUNS);
  const runs = await Promise.all(
    newest.map(async (name) => {
      try {
        return parseBackupRun(name, await readFile(join(runsDir, name), 'utf8'));
      } catch {
        return null;
      }
    }),
  );
  return runs.filter((run) => run !== null);
}

const requestFile = (backupsDir: string) => join(backupsDir, 'requests', 'now');

/** Whether a backup was asked for and the backup service hasn't picked it up yet. */
export async function backupRequested(backupsDir: string): Promise<boolean> {
  try {
    await access(requestFile(backupsDir));
    return true;
  } catch {
    return false;
  }
}

export type BackupRequest = 'requested' | 'pending' | 'unavailable';

/**
 * Asks the backup service for a backup (each one ends with a restore test): `pending` when one
 * was already asked for, `unavailable` when backups aren't set up on this server.
 */
export async function requestBackup(backupsDir: string, now: Date): Promise<BackupRequest> {
  try {
    await writeFile(requestFile(backupsDir), `${now.toISOString()}\n`, { flag: 'wx' });
    return 'requested';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'pending' : 'unavailable';
  }
}
