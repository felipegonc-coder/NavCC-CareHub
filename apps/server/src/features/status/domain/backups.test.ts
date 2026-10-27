import { describe, expect, it } from 'vitest';
import {
  type BackupRun,
  backupSize,
  failureReason,
  nextBackupAt,
  parseBackupRun,
  restoreTestDetails,
  summarizeBackups,
} from './backups';

const TESTED =
  'Restored into a scratch database: 12 tables (as listed in the dump), 3456 rows. ' +
  'Read back the files archive: 78 files.';

// The example from deploy/README.md.
const goodFile = JSON.stringify({
  startedAt: '2026-10-27T08:00:00Z',
  finishedAt: '2026-10-27T08:00:09Z',
  ok: true,
  dbBytes: 1048576,
  filesBytes: 52428800,
  restoreTest: { ok: true, checkedAt: '2026-10-27T08:00:08Z', details: TESTED },
});

function run(stamp: string, changes: Partial<BackupRun> = {}): BackupRun {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  const startedAt = new Date(`${m?.[1]}-${m?.[2]}-${m?.[3]}T${m?.[4]}:${m?.[5]}:${m?.[6]}Z`);
  return {
    stamp,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 9_000),
    ok: true,
    dbBytes: 1_000,
    filesBytes: 20_000,
    restoreOk: true,
    restoreCheckedAt: new Date(startedAt.getTime() + 8_000),
    details: TESTED,
    ...changes,
  };
}

const notRun = { ok: false, dbBytes: null, filesBytes: null, restoreOk: false };

describe('parseBackupRun', () => {
  it('reads a good run', () => {
    expect(parseBackupRun('20261027T080000Z.json', goodFile)).toEqual({
      stamp: '20261027T080000Z',
      startedAt: new Date('2026-10-27T08:00:00Z'),
      finishedAt: new Date('2026-10-27T08:00:09Z'),
      ok: true,
      dbBytes: 1048576,
      filesBytes: 52428800,
      restoreOk: true,
      restoreCheckedAt: new Date('2026-10-27T08:00:08Z'),
      details: TESTED,
    });
  });

  it('reads a failed run, with nulls for what the service did not get to', () => {
    const text = JSON.stringify({
      startedAt: '2026-10-27T08:00:00Z',
      finishedAt: '2026-10-27T08:00:02Z',
      ok: false,
      dbBytes: null,
      filesBytes: null,
      restoreTest: { ok: false, checkedAt: null, details: 'Not run: pg_dump failed.' },
    });
    expect(parseBackupRun('20261027T080000Z.json', text)).toMatchObject({
      ok: false,
      dbBytes: null,
      restoreOk: false,
      restoreCheckedAt: null,
      details: 'Not run: pg_dump failed.',
    });
  });

  it('takes the start time from the file name when the file has none', () => {
    const text = goodFile.replace('"startedAt":"2026-10-27T08:00:00Z"', '"startedAt":null');
    expect(parseBackupRun('20261027T080000Z.json', text)?.startedAt).toEqual(
      new Date('2026-10-27T08:00:00Z'),
    );
  });

  it('skips anything that is not a run file', () => {
    expect(parseBackupRun('status.json', goodFile)).toBeNull();
    expect(parseBackupRun('.run.json', goodFile)).toBeNull();
    expect(parseBackupRun('20261027T080000Z.json.partial', goodFile)).toBeNull();
    expect(parseBackupRun('20260230T080000Z.json', goodFile)).toBeNull();
    expect(parseBackupRun('20261027T250000Z.json', goodFile)).toBeNull();
    expect(parseBackupRun('20261027T080000Z.json', '{"startedAt": ')).toBeNull();
    expect(
      parseBackupRun('20261027T080000Z.json', goodFile.replace('"ok":true', '"ok":"yes"')),
    ).toBeNull();
    expect(parseBackupRun('20261027T080000Z.json', goodFile.replace('1048576', '-1'))).toBeNull();
    expect(parseBackupRun('20261027T080000Z.json', '[]')).toBeNull();
  });
});

describe('failureReason', () => {
  it('ST-06: gives the reason a backup failed, in the service’s words', () => {
    expect(failureReason({ ok: false, details: 'Not run: pg_dump failed.' })).toBe(
      'pg_dump failed',
    );
    expect(failureReason({ ok: false, details: 'Failed: the dump does not restore.' })).toBe(
      'the dump does not restore',
    );
    expect(
      failureReason({
        ok: false,
        details: `${TESTED} The backup failed afterwards: the backup failed (exit 1).`,
      }),
    ).toBe('the backup failed (exit 1)');
  });

  it('is null for good runs and when there is no reason', () => {
    expect(failureReason({ ok: true, details: TESTED })).toBeNull();
    expect(failureReason({ ok: false, details: null })).toBeNull();
    expect(failureReason({ ok: false, details: '  ' })).toBeNull();
  });
});

describe('restoreTestDetails', () => {
  it('leaves out what failed after the restore test', () => {
    const details = `${TESTED} The backup failed afterwards: the backup failed (exit 1).`;
    expect(restoreTestDetails({ details })).toBe(TESTED);
    expect(restoreTestDetails({ details: TESTED })).toBe(TESTED);
    expect(restoreTestDetails({ details: null })).toBeNull();
  });
});

describe('backupSize', () => {
  it('adds the dump and the files archive', () => {
    expect(backupSize({ dbBytes: 1048576, filesBytes: 52428800 })).toBe(53477376);
    expect(backupSize({ dbBytes: null, filesBytes: null })).toBeNull();
  });
});

describe('nextBackupAt', () => {
  it('is today at BACKUP_AT if that is still ahead, otherwise tomorrow', () => {
    // 18:30 on October 26 in Denver: the next 02:00 is on October 27.
    const evening = new Date('2026-10-27T00:30:00Z');
    expect(nextBackupAt(evening, '02:00', 'America/Denver')).toEqual(
      new Date('2026-10-27T08:00:00Z'),
    );
    const justBefore = new Date('2026-10-27T07:59:59Z');
    expect(nextBackupAt(justBefore, '02:00', 'America/Denver')).toEqual(
      new Date('2026-10-27T08:00:00Z'),
    );
    const onTheDot = new Date('2026-10-27T08:00:00Z');
    expect(nextBackupAt(onTheDot, '02:00', 'America/Denver')).toEqual(
      new Date('2026-10-28T08:00:00Z'),
    );
  });

  it('follows the clocks changing', () => {
    // Denver is on winter time from November 1, so 02:00 is an hour later in UTC.
    expect(nextBackupAt(new Date('2026-10-31T12:00:00Z'), '02:00', 'America/Denver')).toEqual(
      new Date('2026-11-01T09:00:00Z'),
    );
    // 02:00 doesn't happen on March 8 in Denver; the service backs up at 03:00 summer time.
    expect(nextBackupAt(new Date('2026-03-08T07:00:00Z'), '02:00', 'America/Denver')).toEqual(
      new Date('2026-03-08T09:00:00Z'),
    );
  });

  it('refuses a BACKUP_AT that is not HH:mm', () => {
    expect(() => nextBackupAt(new Date(), '2am', 'America/Denver')).toThrow('Not a backup time');
  });
});

describe('summarizeBackups', () => {
  const schedule = {
    now: new Date('2026-10-27T15:00:00Z'),
    backupAt: '02:00',
    timeZone: 'America/Denver',
  };

  it('has nothing but the next backup before the first one ("No backups yet")', () => {
    expect(summarizeBackups([], schedule)).toEqual({
      lastGood: null,
      latest: null,
      lastRestoreTest: null,
      next: new Date('2026-10-28T08:00:00Z'),
    });
  });

  it('shows the last good backup with its size and restore test', () => {
    const runs = [run('20261025T080000Z'), run('20261027T080000Z'), run('20261026T080000Z')];
    expect(summarizeBackups(runs, schedule)).toEqual({
      lastGood: {
        stamp: '20261027T080000Z',
        at: new Date('2026-10-27T08:00:00Z'),
        sizeBytes: 21_000,
      },
      latest: {
        stamp: '20261027T080000Z',
        at: new Date('2026-10-27T08:00:00Z'),
        ok: true,
        reason: null,
      },
      lastRestoreTest: { at: new Date('2026-10-27T08:00:08Z'), ok: true, details: TESTED },
      next: new Date('2026-10-28T08:00:00Z'),
    });
  });

  it('ST-06: shows a failed latest backup with its reason, next to the last good one', () => {
    const failed = run('20261027T080000Z', {
      ...notRun,
      restoreCheckedAt: null,
      details: 'Not run: could not archive /data/files.',
    });
    const summary = summarizeBackups([run('20261026T080000Z'), failed], schedule);
    expect(summary.latest).toEqual({
      stamp: '20261027T080000Z',
      at: new Date('2026-10-27T08:00:00Z'),
      ok: false,
      reason: 'could not archive /data/files',
    });
    expect(summary.lastGood?.stamp).toBe('20261026T080000Z');
    // That restore test never ran, so the last one is still the day before's.
    expect(summary.lastRestoreTest?.at).toEqual(new Date('2026-10-26T08:00:08Z'));
  });

  it('shows a failed restore test as the last restore test', () => {
    const failed = run('20261027T080000Z', {
      ...notRun,
      details: 'Failed: the dump does not restore.',
    });
    const summary = summarizeBackups([run('20261026T080000Z'), failed], schedule);
    expect(summary.lastRestoreTest).toEqual({
      at: new Date('2026-10-27T08:00:08Z'),
      ok: false,
      details: 'Failed: the dump does not restore.',
    });
  });

  it('has no last good backup when every run failed', () => {
    const failed = run('20261027T080000Z', { ...notRun, details: 'Not run: pg_dump failed.' });
    expect(summarizeBackups([failed], schedule).lastGood).toBeNull();
  });
});
