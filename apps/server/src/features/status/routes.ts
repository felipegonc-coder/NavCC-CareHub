// /api/status (Status page spec): the overall status and uptime for everyone, details and backup
// requests for site admins.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { backupRequested, readBackupRuns, requestBackup } from './checks';
import { summarizeBackups } from './domain/backups';
import type { IncidentCause } from './domain/incidents';
import {
  PARTS,
  overallStatus,
  type OverallStatus,
  type Part,
  type PartState,
} from './domain/overall';
import { BACKUP_REQUEST_RULES, checkRate } from './domain/rate-limit';
import { DAY_MINUTES, MINUTE_MS, isTimeZone } from './domain/time';
import { UPTIME_DAYS, uptimeByDay, uptimeOverWindow } from './domain/uptime';
import { registerPeriodicTask } from '../jobs';
import { TICK_MS, createMonitor, isFresh } from './monitor';
import { readStatusSettings } from './settings';
import * as store from './store';

/** GET /api/status: everything people signed out see, and nothing more (ST-01). */
export interface PublicStatus {
  status: OverallStatus;
  uptime: {
    /** The last 30 days (or since installation), to two decimals; null before the first minute. */
    percent: number | null;
    /** The last 30 days in the viewer's time zone, oldest first. Null: not measured. */
    days: { date: string; percent: number | null }[];
  };
}

/** GET /api/status/details, for site admins (ST-02). Times are ISO 8601. */
export interface StatusDetails {
  parts: {
    part: Part;
    state: PartState;
    message: string | null;
    facts: Record<string, unknown>;
    checkedAt: string | null;
  }[];
  backups: {
    /** The backup service's runs folder is there. */
    setUp: boolean;
    lastGood: { at: string; sizeBytes: number | null } | null;
    latest: { at: string; ok: boolean; reason: string | null } | null;
    lastRestoreTest: { at: string; ok: boolean; details: string | null } | null;
    next: string;
    /** Asked for, and the backup service hasn't started it yet. */
    requested: boolean;
  };
  /** The last 30 days, newest first. */
  incidents: { start: string; end: string; minutes: number; cause: IncidentCause }[];
  version: { number: string; buildDate: string | null; updatedAt: string | null };
}

const publicQuery = z.object({ tz: z.string().max(100).optional() });

const ALREADY_ASKED = 'A backup was already asked for. It starts within a minute.';
const NOT_SET_UP =
  "Backups aren't set up on this server, so there's nothing to run. See deploy/README.md.";

function waitWords(ms: number): string {
  const minutes = Math.ceil(ms / MINUTE_MS);
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

const statusRoutes: FastifyPluginAsync = async (app) => {
  const settings = readStatusSettings({ log: app.log });
  const monitor = createMonitor(app.db, settings, app.log);
  // Once at start, so the first heartbeat is in right away, then every 30 seconds while the jobs
  // runner runs. Unit tests call monitor.tick() themselves.
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    registerPeriodicTask('status.check', TICK_MS, () => monitor.tick());
    app.addHook('onReady', async () => {
      void monitor.tick();
    });
  }
  app.addHook('preClose', async () => monitor.stop());

  app.get('/', { config: { public: true } }, async (request): Promise<PublicStatus> => {
    const { tz } = publicQuery.parse(request.query);
    const zone = [tz, request.user?.timeZone].find(
      (name) => name !== undefined && isTimeZone(name),
    );
    const now = new Date();
    const view = await monitor.view(now);
    const options = { now, installedAt: view.installedAt };
    const days = uptimeByDay(view.spans, { ...options, timeZone: zone ?? settings.TZ });
    return {
      status: overallStatus(view.states),
      uptime: {
        percent: uptimeOverWindow(view.spans, options).percent,
        days: days.map(({ date, percent }) => ({ date, percent })),
      },
    };
  });

  app.get('/details', { preHandler: app.requireSiteAdmin }, async (): Promise<StatusDetails> => {
    const now = new Date();
    const since = new Date(now.getTime() - UPTIME_DAYS * DAY_MINUTES * MINUTE_MS);
    const [checks, incidents, server, runs, requested] = await Promise.all([
      store.listChecks(app.db),
      store.listIncidents(app.db, since),
      store.getServerInfo(app.db),
      readBackupRuns(settings.BACKUPS_DIR),
      backupRequested(settings.BACKUPS_DIR),
    ]);
    const byPart = new Map(checks.map((check) => [check.part, check]));
    const backups = summarizeBackups(runs ?? [], {
      now,
      backupAt: settings.BACKUP_AT,
      timeZone: settings.TZ,
    });
    const { lastGood, latest, lastRestoreTest } = backups;
    return {
      parts: PARTS.map((part): StatusDetails['parts'][number] => {
        const check = byPart.get(part);
        // Answering this means the server and the database work.
        if (part === 'server' || part === 'database') {
          return { part, state: 'ok', message: null, facts: {}, checkedAt: now.toISOString() };
        }
        if (!check || !isFresh(check, now)) {
          const message = 'Not checked in the last 5 minutes. Restart Care Hub if this stays.';
          return { part, state: 'unknown', message, facts: {}, checkedAt: null };
        }
        const { state, message, facts } = check;
        return { part, state, message, facts, checkedAt: check.checkedAt.toISOString() };
      }),
      backups: {
        setUp: runs !== null,
        lastGood: lastGood && { at: lastGood.at.toISOString(), sizeBytes: lastGood.sizeBytes },
        latest: latest && { at: latest.at.toISOString(), ok: latest.ok, reason: latest.reason },
        lastRestoreTest: lastRestoreTest && {
          at: lastRestoreTest.at.toISOString(),
          ok: lastRestoreTest.ok,
          details: lastRestoreTest.details,
        },
        next: backups.next.toISOString(),
        requested,
      },
      incidents: incidents.map(({ start, end, cause }) => ({
        start: start.toISOString(),
        end: end.toISOString(),
        minutes: store.minutesBetween(start, end),
        cause,
      })),
      version: {
        number: settings.CAREHUB_VERSION,
        buildDate: settings.CAREHUB_BUILD_DATE
          ? new Date(settings.CAREHUB_BUILD_DATE).toISOString()
          : null,
        updatedAt:
          server?.version === settings.CAREHUB_VERSION ? server.versionSince.toISOString() : null,
      },
    };
  });

  // Back up now and Test a restore now: every backup ends with a restore test, so both ask the
  // backup service for a backup. Counted together for the whole server: 3 an hour, 10 a day.
  const accepted: Date[] = [];
  app.post('/backup', { preHandler: app.requireSiteAdmin }, async (_request, reply) => {
    const now = new Date();
    if (await backupRequested(settings.BACKUPS_DIR))
      throw httpError(409, 'conflict', ALREADY_ASKED);
    const rate = checkRate(accepted, now, BACKUP_REQUEST_RULES);
    if (!rate.ok) {
      reply.header('Retry-After', String(Math.ceil(rate.retryAfterMs / 1000)));
      throw httpError(
        429,
        'rate_limited',
        `That's the most backups for now. Try again in ${waitWords(rate.retryAfterMs)}.`,
        { retryAfterSeconds: Math.ceil(rate.retryAfterMs / 1000) },
      );
    }
    const result = await requestBackup(settings.BACKUPS_DIR, now);
    if (result === 'pending') throw httpError(409, 'conflict', ALREADY_ASKED);
    if (result === 'unavailable') throw httpError(409, 'conflict', NOT_SET_UP);
    accepted.push(now);
    // Keep only what the daily rule needs.
    while (accepted.length > 10) accepted.shift();
    reply.code(202);
    return { requested: true };
  });
};

export default statusRoutes;
