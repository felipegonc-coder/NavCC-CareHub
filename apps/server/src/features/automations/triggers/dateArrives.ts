/**
 * The Date arrives trigger on the server (Automations spec, section 3; AU-15, AU-05). Every 30
 * seconds each switched-on Date arrives automation asks Databases, as its owner, for the rows whose
 * date can arrive since its last check, and queues a run for each arrival. Rows in Trash and rows
 * the owner can't open never come back. The key is the row and the arrival time, so an arrival
 * runs once, even across restarts, and a moved date runs at its new time. After a stop the check
 * carries on from where it was, and the runner logs arrivals an hour late or more as Missed.
 */
import {
  arrivalsBetween,
  datesToCheck,
  type DateArrivesTrigger,
} from '@carehub/team-automations/dates';
import type { Automation, AutomationStore } from '../domain/types';
import type { DateChecks } from './dateChecks';
import type { ListDatedRows } from './databases';
import type { ActingOwner, PauseAutomation, QueueRun } from './runner';

export const DATES_TASK = 'automations.dates';
/** Arrivals start within a minute of their time (spec, Running). */
export const DATES_EVERY_MS = 30_000;
/** After a long stop, arrivals further back than a day are left alone. */
export const DATES_LOOKBACK_MS = 24 * 60 * 60_000;

export interface DateArrivesDeps {
  store: AutomationStore;
  checks: DateChecks;
  listDatedRows: ListDatedRows;
  queueRun: QueueRun;
  actingOwner: ActingOwner;
  pause: PauseAutomation;
  /** The workspaces to check (Care Hub has one). */
  workspaceIds: () => Promise<string[]>;
}

type DateAutomation = Automation & { trigger: DateArrivesTrigger };
const watchesDates = (automation: Automation): automation is DateAutomation =>
  automation.trigger.kind === 'dateArrives';

/** Checks every Date arrives automation up to `now`. One that fails is tried again next time. */
export async function checkDates(deps: DateArrivesDeps, now: Date): Promise<void> {
  const automations: DateAutomation[] = [];
  for (const workspaceId of await deps.workspaceIds()) {
    const switchedOn = await deps.store.list(workspaceId, { enabled: true });
    automations.push(...switchedOn.filter(watchesDates));
  }
  const ids = automations.map((automation) => automation.id);
  // One switched off forgets its check: switched on again, it starts from then.
  await deps.checks.keepOnly(ids);
  const checked = await deps.checks.load(ids);
  const failures: unknown[] = [];
  for (const automation of automations) {
    const from = checked.get(automation.id) ?? automation.updatedAt;
    const since = new Date(Math.max(from.getTime(), now.getTime() - DATES_LOOKBACK_MS));
    if (since >= now) continue;
    try {
      if (await queueArrivals(deps, automation, since, now)) {
        await deps.checks.save(automation.id, now);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

/** Queues the arrivals after `since` and up to `now`; false when it can't run anymore. */
async function queueArrivals(
  deps: DateArrivesDeps,
  automation: DateAutomation,
  since: Date,
  now: Date,
): Promise<boolean> {
  const acting = await deps.actingOwner(automation);
  if (acting === null) return false;
  const { owner } = acting;
  const { trigger } = automation;
  const found = await deps.listDatedRows(
    { userId: owner.userId, workspaceId: automation.workspaceId },
    {
      databaseId: trigger.databaseId,
      propertyId: trigger.propertyId,
      viewId: null,
      ...datesToCheck(trigger, since, now),
      timeZone: trigger.timeZone,
    },
  );
  if (found === null) {
    const reason = `${owner.name} can't open the database or its date property anymore.`;
    await deps.pause(automation, reason);
    return false;
  }
  for (const { row, at } of arrivalsBetween(trigger, found.rows, since, now)) {
    await deps.queueRun(automation, {
      kind: 'triggered',
      key: `date:${row.rowId}:${at.toISOString()}`,
      source: { databaseId: trigger.databaseId, rowId: row.rowId },
      triggeredBy: null,
      plannedFor: at,
    });
  }
  return true;
}
