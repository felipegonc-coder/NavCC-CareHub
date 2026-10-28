// The status monitor: a heartbeat and part checks every 30 seconds, as a periodic task of the jobs
// feature (one run at a time across processes), so every minute gets its heartbeat (Status page
// spec, section 3).
import type { FastifyBaseLogger } from 'fastify';
import type { Db, Tx } from '../../db';
import { checkFileStorage } from './checks';
import { incidentCause, missedMinutes, type PreviousRun } from './domain/incidents';
import type { Part, PartState } from './domain/overall';
import { DAY_MINUTES, MINUTE_MS, epochMinute } from './domain/time';
import { UPTIME_DAYS, type MinuteSpan } from './domain/uptime';
import type { StatusSettings } from './settings';
import * as store from './store';

export const TICK_MS = 30_000;
/** A database that doesn't answer within this long counts as down. */
const DATABASE_TIMEOUT_MS = 5_000;
/** Heartbeats are kept for 35 days. */
const KEEP_MINUTES = 35 * DAY_MINUTES;
/** Checks older than this weren't made by a running monitor, so they don't count. */
const STALE_CHECK_MS = 5 * MINUTE_MS;

/** Whether a saved check is recent enough to count. */
export function isFresh(check: { checkedAt: Date }, now: Date): boolean {
  return now.getTime() - check.checkedAt.getTime() <= STALE_CHECK_MS;
}
/** The uptime bars cover 30 days in the viewer's time zone, which can start up to a day earlier. */
const SPAN_MINUTES = (UPTIME_DAYS + 1) * DAY_MINUTES;

/** What the public Status page needs: the heartbeats and each part's state. */
export interface StatusView {
  spans: MinuteSpan[];
  installedAt: Date | null;
  states: Partial<Record<Part, PartState>>;
}

/** Parts that later features check. Until calendar sync lands, there are no calendar connections. */
const NOT_CHECKED: Record<
  Exclude<Part, 'server' | 'database' | 'files' | 'jobs'>,
  Pick<store.PartCheck, 'message' | 'facts'>
> = {
  collab: { message: 'Not checked yet: live editing comes later.', facts: {} },
  calendar: {
    message: 'Not checked yet: calendar sync comes later.',
    facts: { connections: 0, failing: 0 },
  },
};

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export class StatusMonitor {
  private running: Promise<void> | undefined;
  /** The database work of an earlier tick that hasn't finished (the database hangs). */
  private databaseWork: Promise<unknown> | undefined;
  /** Set once this server run is recorded in status_server. */
  private run: { installedAt: Date; previous: PreviousRun | null } | undefined;
  private beatRecorded = false;
  private latest = new Map<Part, store.PartCheck>();
  /** The last heartbeats read, for when the database is down. */
  private cache: { spans: MinuteSpan[]; installedAt: Date | null } = {
    spans: [],
    installedAt: null,
  };

  constructor(
    private readonly db: Db,
    private readonly settings: StatusSettings,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Waits for a round still running, then records an orderly shutdown. Never throws. */
  async stop(now = new Date()): Promise<void> {
    await this.running;
    if (!this.run) return;
    try {
      await withTimeout(store.markStopped(this.db, now), 3_000, 'The database took too long.');
    } catch (error) {
      this.log.warn({ err: error }, "status: couldn't record the shutdown");
    }
  }

  /** One round of checks (the jobs feature runs it); a round still running is awaited instead. */
  tick(now = new Date()): Promise<void> {
    this.running ??= this.check(now)
      .catch((error: unknown) => this.log.error({ err: error }, 'status: the checks failed'))
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async check(now: Date): Promise<void> {
    const files = await checkFileStorage(this.settings.FILES_DIR);
    const others = Object.entries(NOT_CHECKED).map(([part, check]): store.PartCheck => ({
      part: part as Part,
      state: 'unknown',
      ...check,
    }));
    const checks: store.PartCheck[] = [
      { part: 'server', state: 'ok', message: null, facts: {} },
      { part: 'database', state: 'ok', message: null, facts: {} },
      files,
      // This round is a background job, so background jobs run.
      { part: 'jobs', state: 'ok', message: null, facts: {} },
      ...others,
    ];
    let database: store.PartCheck = { part: 'database', state: 'ok', message: null, facts: {} };
    if (this.databaseWork) {
      database = { ...database, state: 'down', message: "The database isn't answering." };
    } else {
      const work = this.db.transaction((tx) => this.record(tx, now, checks));
      this.databaseWork = work;
      void work.then(
        () => (this.databaseWork = undefined),
        () => (this.databaseWork = undefined),
      );
      try {
        const done = await withTimeout(work, DATABASE_TIMEOUT_MS, 'The database took too long.');
        this.run ??= done.run;
        this.beatRecorded = true;
        this.cache = { spans: done.spans, installedAt: this.run.installedAt };
      } catch (error) {
        this.log.warn({ err: error }, "status: couldn't reach the database");
        database = { ...database, state: 'down', message: "Care Hub can't reach the database." };
      }
    }
    for (const check of [...checks, database]) this.latest.set(check.part, check);
  }

  /** Heartbeat, incident and checks in one transaction. */
  private async record(tx: Tx, now: Date, checks: readonly store.PartCheck[]) {
    const run =
      this.run ??
      (await store.startRun(tx, {
        at: now,
        version: this.settings.CAREHUB_VERSION,
        buildDate: this.settings.CAREHUB_BUILD_DATE
          ? new Date(this.settings.CAREHUB_BUILD_DATE)
          : null,
      }));
    const minute = epochMinute(now.getTime());
    const beat = await store.recordHeartbeat(tx, minute);
    const gap = beat.inserted ? missedMinutes(beat.previous, minute) : null;
    if (gap) {
      const cause = incidentCause({
        endsAtStart: !this.beatRecorded,
        previous: run.previous,
        version: this.settings.CAREHUB_VERSION,
      });
      await store.recordIncident(tx, { ...gap, cause });
    }
    await store.saveChecks(tx, checks, now);
    if (!this.beatRecorded || minute % 60 === 0) {
      await store.pruneHeartbeats(tx, new Date((minute - KEEP_MINUTES) * MINUTE_MS));
    }
    const spans = await store.listUpSpans(tx, minute - SPAN_MINUTES);
    return { run, spans };
  }

  /**
   * The heartbeats and part states for the public page, read fresh. When the database can't be
   * reached it says so, with the heartbeats read last.
   */
  async view(now = new Date()): Promise<StatusView> {
    try {
      const [spans, server, checks] = await withTimeout(
        Promise.all([
          store.listUpSpans(this.db, epochMinute(now.getTime()) - SPAN_MINUTES),
          store.getServerInfo(this.db),
          store.listChecks(this.db),
        ]),
        DATABASE_TIMEOUT_MS,
        'The database took too long.',
      );
      this.cache = { spans, installedAt: server?.installedAt ?? null };
      const states: StatusView['states'] = {};
      for (const check of checks) {
        if (isFresh(check, now)) states[check.part] = check.state;
      }
      return { ...this.cache, states: { ...states, server: 'ok', database: 'ok' } };
    } catch (error) {
      this.log.warn({ err: error }, "status: couldn't read the heartbeats");
      const states: StatusView['states'] = {};
      for (const [part, check] of this.latest) states[part] = check.state;
      return { ...this.cache, states: { ...states, server: 'ok', database: 'down' } };
    }
  }
}

const monitors = new WeakMap<Db, StatusMonitor>();

/** The monitor of the app that uses this database (one per app). */
export function createMonitor(db: Db, settings: StatusSettings, log: FastifyBaseLogger) {
  const monitor = new StatusMonitor(db, settings, log);
  monitors.set(db, monitor);
  return monitor;
}

/** For tests: the monitor of the app on `db` (tests call `tick` themselves). */
export function monitorFor(db: Db): StatusMonitor {
  const monitor = monitors.get(db);
  if (!monitor) throw new Error('No status monitor for this database.');
  return monitor;
}
