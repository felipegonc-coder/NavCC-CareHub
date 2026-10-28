import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import type { PublicStatus, StatusDetails } from './routes';
import { seed } from './seed';

describe.skipIf(!hasDatabase)('/api/status', () => {
  let t: TestApp;
  let backups: string;
  let admin: TestUser;
  let member: TestUser;

  const heartbeats = async () => {
    const result = await t.db.execute(sql`SELECT count(*)::int AS n FROM status_heartbeats`);
    return (result.rows[0] as { n: number }).n;
  };
  const details = async () => {
    const response = await injectAs(t.app, admin, { method: 'GET', url: '/api/status/details' });
    expect(response.statusCode).toBe(200);
    return response.json<StatusDetails>();
  };
  const askForBackup = (user: TestUser) =>
    injectAs(t.app, user, { method: 'POST', url: '/api/status/backup' });
  const requestFile = () => join(backups, 'requests', 'now');

  beforeAll(async () => {
    backups = await mkdtemp(join(tmpdir(), 'carehub-status-'));
    await mkdir(join(backups, 'runs'));
    await mkdir(join(backups, 'requests'));
    vi.stubEnv('BACKUPS_DIR', backups);
    vi.stubEnv('CAREHUB_VERSION', '2.4.0');
    vi.stubEnv('CAREHUB_BUILD_DATE', '');
    t = await createTestApp();
    await seed({ db: t.db, log: t.app.log });
    admin = await createUser(t.db, { siteAdmin: true, name: 'Avery Lin' });
    member = await createUser(t.db, { name: 'Sam Ortiz' });
  });

  afterAll(async () => {
    await t?.close();
    vi.unstubAllEnvs();
    await rm(backups, { recursive: true, force: true });
  });

  it('ST-01 ST-10: shows people signed out only the overall status and uptime', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/status?tz=America/Denver' });
    expect(response.statusCode).toBe(200);
    const body = response.json<PublicStatus>();
    expect(Object.keys(body).sort()).toEqual(['status', 'uptime']);
    expect(Object.keys(body.uptime).sort()).toEqual(['days', 'percent']);
    expect(body.status).toBe('working');
    // The seed leaves out 43 minutes in the last 30 days.
    expect(body.uptime.percent).toBe(99.9);
    expect(body.uptime.days).toHaveLength(30);
    for (const day of body.uptime.days)
      expect(Object.keys(day).sort()).toEqual(['date', 'percent']);
    const below100 = body.uptime.days.filter((day) => day.percent !== null && day.percent < 100);
    expect(below100).toHaveLength(3);
    expect(Math.min(...below100.map((day) => day.percent ?? 100))).toBeLessThan(99);
  });

  it('gives signed-in people the same, nothing more, and ignores unknown time zones', async () => {
    const response = await injectAs(t.app, member, {
      method: 'GET',
      url: '/api/status?tz=Mars/Base',
    });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json()).sort()).toEqual(['status', 'uptime']);
    expect(response.json<PublicStatus>().uptime.days).toHaveLength(30);
  });

  it('seeds the history only once', async () => {
    const before = await heartbeats();
    await seed({ db: t.db, log: t.app.log });
    expect(await heartbeats()).toBe(before);
  });

  it('ST-02 ST-08: refuses the details to people signed out (401) and to everyone else (403)', async () => {
    const signedOut = await t.app.inject({ method: 'GET', url: '/api/status/details' });
    expect(signedOut.statusCode).toBe(401);
    const response = await injectAs(t.app, member, { method: 'GET', url: '/api/status/details' });
    expect(response.statusCode).toBe(403);
  });

  it('ST-02: shows site admins every part, backups, incidents and the version', async () => {
    const body = await details();
    expect(body.parts.map((part) => part.part)).toEqual([
      'server',
      'database',
      'files',
      'collab',
      'jobs',
      'calendar',
    ]);
    expect(body.parts[0]).toMatchObject({ state: 'ok' });
    expect(body.parts[1]).toMatchObject({ state: 'ok' });
    // Nothing has been checked: the monitor doesn't run in tests.
    expect(body.parts[2]).toMatchObject({ state: 'unknown', checkedAt: null });
    expect(body.backups).toMatchObject({
      setUp: true,
      lastGood: null,
      latest: null,
      lastRestoreTest: null,
      requested: false,
    });
    expect(Date.parse(body.backups.next)).toBeGreaterThan(Date.now());
    expect(body.incidents.map((incident) => [incident.minutes, incident.cause])).toEqual([
      [5, 'update'],
      [3, 'restart'],
      [35, 'unknown'],
    ]);
    expect(body.version).toEqual({
      number: '2.4.0',
      buildDate: null,
      updatedAt: expect.any(String),
    });
  });

  it('ST-06: shows the last good backup, its size and restore test, and a failed latest one', async () => {
    const run = (startedAt: string, fields: object) =>
      JSON.stringify({ startedAt, finishedAt: startedAt, ...fields });
    await writeFile(
      join(backups, 'runs', '20261020T080000Z.json'),
      run('2026-10-20T08:00:00Z', {
        ok: true,
        dbBytes: 1000,
        filesBytes: 2000,
        restoreTest: {
          ok: true,
          checkedAt: '2026-10-20T08:00:08Z',
          details: 'Restored into a scratch database: 12 tables, 3456 rows.',
        },
      }),
    );
    await writeFile(
      join(backups, 'runs', '20261021T080000Z.json'),
      run('2026-10-21T08:00:00Z', {
        ok: false,
        dbBytes: null,
        filesBytes: null,
        restoreTest: { ok: false, checkedAt: null, details: 'Not run: pg_dump failed.' },
      }),
    );
    const { backups: summary } = await details();
    expect(summary).toMatchObject({
      lastGood: { at: '2026-10-20T08:00:00.000Z', sizeBytes: 3000 },
      latest: { at: '2026-10-21T08:00:00.000Z', ok: false, reason: 'pg_dump failed' },
      lastRestoreTest: { at: '2026-10-20T08:00:08.000Z', ok: true },
    });
  });

  it('ST-08: asks the backup service for a backup, one at a time', async () => {
    const signedOut = await t.app.inject({ method: 'POST', url: '/api/status/backup' });
    expect(signedOut.statusCode).toBe(401);
    expect((await askForBackup(member)).statusCode).toBe(403);

    const first = await askForBackup(admin);
    expect(first.statusCode).toBe(202);
    expect(await readFile(requestFile(), 'utf8')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await details()).backups.requested).toBe(true);

    const again = await askForBackup(admin);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({
      error: {
        code: 'conflict',
        message: 'A backup was already asked for. It starts within a minute.',
      },
    });
  });

  it('allows 3 backup requests an hour, then says when to try again', async () => {
    // The first one is from the test above; the backup service deletes the file when it starts.
    for (let i = 0; i < 2; i += 1) {
      await rm(requestFile(), { force: true });
      expect((await askForBackup(admin)).statusCode).toBe(202);
    }
    await rm(requestFile(), { force: true });
    const limited = await askForBackup(admin);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({ code: 'rate_limited' });
    expect(limited.json().error.message).toMatch(
      /^That's the most backups for now\. Try again in /,
    );
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
