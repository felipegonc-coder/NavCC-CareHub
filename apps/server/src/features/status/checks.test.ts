import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupRequested, checkFileStorage, readBackupRuns, requestBackup } from './checks';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'carehub-status-checks-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('checkFileStorage', () => {
  it('measures the disk under a folder Care Hub can write to', async () => {
    const check = await checkFileStorage(dir);
    expect(check.part).toBe('files');
    expect(['ok', 'problem']).toContain(check.state);
    const facts = check.facts as { freeBytes: number; totalBytes: number };
    expect(facts.totalBytes).toBeGreaterThan(0);
    expect(facts.freeBytes).toBeGreaterThanOrEqual(0);
    expect(facts.freeBytes).toBeLessThanOrEqual(facts.totalBytes);
  });

  it('is down when the folder is missing', async () => {
    const check = await checkFileStorage(join(dir, 'missing'));
    expect(check).toMatchObject({
      state: 'down',
      message: "Care Hub can't find the files folder.",
    });
  });

  it('is not checked without FILES_DIR', async () => {
    expect(await checkFileStorage(undefined)).toMatchObject({ state: 'unknown', facts: {} });
  });
});

describe('readBackupRuns', () => {
  const good = {
    startedAt: '2026-10-27T08:00:00Z',
    finishedAt: '2026-10-27T08:00:09Z',
    ok: true,
    dbBytes: 10,
    filesBytes: 20,
    restoreTest: { ok: true, checkedAt: '2026-10-27T08:00:08Z', details: 'Restored.' },
  };

  it('is null when backups are not set up (no runs folder)', async () => {
    expect(await readBackupRuns(dir)).toBeNull();
  });

  it('reads the run files and skips everything else', async () => {
    await mkdir(join(dir, 'runs'));
    await writeFile(join(dir, 'runs', '20261027T080000Z.json'), JSON.stringify(good));
    await writeFile(join(dir, 'runs', '20261026T080000Z.json'), '{ broken');
    await writeFile(join(dir, 'runs', 'notes.txt'), 'not a run');
    const runs = await readBackupRuns(dir);
    expect(runs?.map((run) => [run.stamp, run.ok, run.dbBytes])).toEqual([
      ['20261027T080000Z', true, 10],
    ]);
  });
});

describe('requestBackup', () => {
  it('writes requests/now, once until the backup service takes it', async () => {
    await mkdir(join(dir, 'requests'));
    expect(await backupRequested(dir)).toBe(false);
    const now = new Date('2026-10-27T15:04:00Z');
    expect(await requestBackup(dir, now)).toBe('requested');
    expect(await readFile(join(dir, 'requests', 'now'), 'utf8')).toBe('2026-10-27T15:04:00.000Z\n');
    expect(await backupRequested(dir)).toBe(true);
    expect(await requestBackup(dir, now)).toBe('pending');
  });

  it('is unavailable when backups are not set up', async () => {
    expect(await requestBackup(dir, new Date())).toBe('unavailable');
    expect(await requestBackup(join(dir, 'missing'), new Date())).toBe('unavailable');
  });
});
