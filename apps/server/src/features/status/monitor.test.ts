import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../testing';
import { MINUTE_MS } from './domain/time';
import { StatusMonitor, monitorFor } from './monitor';
import type { PublicStatus } from './routes';
import { readStatusSettings } from './settings';

describe.skipIf(!hasDatabase)('status monitor', () => {
  let t: TestApp;
  let files: string;
  let admin: pg.Pool;
  let databaseName: string;
  // Whole minutes an hour ago and later, so the ticks below make a known history.
  const start = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - 60 * MINUTE_MS;
  const minute = (n: number, seconds = 0) => new Date(start + n * MINUTE_MS + seconds * 1000);

  const select = async <Row>(query: SQL) => (await t.db.execute(query)).rows as unknown as Row[];
  const incidents = () =>
    select<{ start_ms: number; end_ms: number; cause: string }>(
      sql`SELECT (extract(epoch FROM started_at) * 1000)::float8 AS start_ms,
            (extract(epoch FROM ended_at) * 1000)::float8 AS end_ms, cause
          FROM status_incidents ORDER BY started_at`,
    );
  const server = async () =>
    (
      await select<{ version: string; stopped: boolean; since_ms: number }>(
        sql`SELECT version, stopped_at IS NOT NULL AS stopped,
              (extract(epoch FROM version_since) * 1000)::float8 AS since_ms
            FROM status_server`,
      )
    )[0];
  /** A new server run on the same database, as after a restart or an update. */
  const nextRun = (version: string) =>
    new StatusMonitor(t.db, { ...readStatusSettings(), CAREHUB_VERSION: version }, t.app.log);
  const allowConnections = (allow: boolean) =>
    admin.query(`ALTER DATABASE "${databaseName}" WITH ALLOW_CONNECTIONS ${allow}`);

  beforeAll(async () => {
    files = await mkdtemp(join(tmpdir(), 'carehub-files-'));
    vi.stubEnv('FILES_DIR', files);
    vi.stubEnv('CAREHUB_VERSION', '3.0.0');
    t = await createTestApp();
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const [database] = await select<{ name: string }>(sql`SELECT current_database() AS name`);
    if (!database) throw new Error('No database name.');
    databaseName = database.name;
  });

  afterAll(async () => {
    await admin?.end();
    await t?.close();
    vi.unstubAllEnvs();
    await rm(files, { recursive: true, force: true });
  });

  it('records the run, a heartbeat and every part on the first tick', async () => {
    await monitorFor(t.db).tick(minute(0));
    expect(await server()).toMatchObject({ version: '3.0.0', stopped: false });
    const beats = await select<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM status_heartbeats`,
    );
    expect(beats[0]?.n).toBe(1);
    const checks = await select<{ part: string; state: string; facts: Record<string, unknown> }>(
      sql`SELECT part, state, facts FROM status_checks ORDER BY part`,
    );
    expect(Object.fromEntries(checks.map((check) => [check.part, check.state]))).toMatchObject({
      server: 'ok',
      database: 'ok',
      collab: 'unknown',
      // The jobs runner runs these rounds, so background jobs work.
      jobs: 'ok',
      calendar: 'unknown',
    });
    const storage = checks.find((check) => check.part === 'files');
    expect(['ok', 'problem']).toContain(storage?.state);
    expect(storage?.facts.totalBytes).toBeGreaterThan(0);
    // No calendar connections until calendar sync lands, so none are failing.
    const calendar = checks.find((check) => check.part === 'calendar');
    expect(calendar?.facts).toEqual({ connections: 0, failing: 0 });
    expect(await incidents()).toEqual([]);
  });

  it('ST-03: records a gap while the server runs as an incident with its length', async () => {
    const monitor = monitorFor(t.db);
    await monitor.tick(minute(1));
    await monitor.tick(minute(1, 30));
    await monitor.tick(minute(6));
    expect(await incidents()).toEqual([
      { start_ms: minute(2).getTime(), end_ms: minute(6).getTime(), cause: 'unknown' },
    ]);
  });

  it('labels the gap of an update "update" and of a restart "restart"', async () => {
    await monitorFor(t.db).stop(minute(7));
    expect(await server()).toMatchObject({ stopped: true });

    await nextRun('3.1.0').tick(minute(10));
    expect(await server()).toMatchObject({
      version: '3.1.0',
      stopped: false,
      since_ms: minute(10).getTime(),
    });
    const restarted = nextRun('3.1.0');
    await restarted.tick(minute(11));
    await restarted.stop(minute(11, 30));
    await nextRun('3.1.0').tick(minute(14));
    // A run that never recorded its shutdown (a crash or a power cut) has no known cause.
    await nextRun('3.1.0').tick(minute(20));
    expect((await incidents()).slice(1)).toEqual([
      { start_ms: minute(7).getTime(), end_ms: minute(10).getTime(), cause: 'update' },
      { start_ms: minute(12).getTime(), end_ms: minute(14).getTime(), cause: 'restart' },
      { start_ms: minute(15).getTime(), end_ms: minute(20).getTime(), cause: 'unknown' },
    ]);
    expect((await server())?.since_ms).toBe(minute(10).getTime());
  });

  it('ST-03: answers /api/status while the database is down', async () => {
    const monitor = monitorFor(t.db);
    await monitor.tick();
    const before = (await t.app.inject({ method: 'GET', url: '/api/status' })).json<PublicStatus>();
    expect(before.uptime.percent).not.toBeNull();

    await allowConnections(false);
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [databaseName],
      );
      await monitor.tick();
      const response = await t.app.inject({ method: 'GET', url: '/api/status' });
      expect(response.statusCode).toBe(200);
      const body = response.json<PublicStatus>();
      expect(body.status).toBe('down');
      // The uptime read last, kept for when the database is down.
      expect(body.uptime.percent).not.toBeNull();
    } finally {
      await allowConnections(true);
    }

    await monitor.tick();
    const after = await t.app.inject({ method: 'GET', url: '/api/status' });
    expect(after.json<PublicStatus>().status).not.toBe('down');
  });
});
