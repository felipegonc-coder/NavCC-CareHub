import { randomUUID } from 'node:crypto';
import type { Trigger } from '@carehub/team-automations/automation';
import type { DateArrivesTrigger, RowDate } from '@carehub/team-automations/dates';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryAutomationStore } from '../domain/memoryStore';
import type { Automation, AutomationStore } from '../domain/types';
import { checkDates, type DateArrivesDeps } from './dateArrives';
import { createMemoryDateChecks } from './dateChecks';
import type { DatedRowsQuery } from './databases';

const workspaceId = randomUUID();
const ownerUserId = randomUUID();
const qaReviews = randomUUID();
const denver = 'America/Denver';
const at = (iso: string) => new Date(iso);
// Denver is on summer time (UTC-6): 9:00 AM there is 15:00 UTC.
const dayBefore: DateArrivesTrigger = {
  kind: 'dateArrives',
  databaseId: qaReviews,
  propertyId: 'review-date',
  offset: { amount: 1, unit: 'days', direction: 'before' },
  time: '09:00',
  timeZone: denver,
};

let store: AutomationStore;
let rows: (RowDate & { rowId: string })[];
let queued: { name: string; key: string; plannedFor: string | undefined }[];
let queries: { userId: string; query: DatedRowsQuery }[];
let paused: { name: string; reason: string }[];
let ownerHere: boolean;
let deps: DateArrivesDeps;

async function add(name: string, trigger: Trigger, now: Date): Promise<Automation> {
  const automation = await store.create(
    {
      workspaceId,
      name,
      ownerUserId,
      enabled: true,
      trigger,
      conditions: null,
      variables: [],
      actions: [
        { kind: 'sendMessage', recipients: [{ kind: 'everyone' }], text: 'Hi', pageIds: [] },
      ],
      nextRunAt: null,
    },
    now,
  );
  if (!automation) throw new Error('not created');
  return automation;
}

const check = (iso: string) => checkDates(deps, at(iso));
const keys = () => queued.map(({ key }) => key);

beforeEach(() => {
  store = createMemoryAutomationStore();
  rows = [
    { rowId: 'review-1', allDay: true, start: '2026-10-29' },
    { rowId: 'review-2', allDay: true, start: '2026-10-30' },
  ];
  queued = [];
  queries = [];
  paused = [];
  ownerHere = true;
  deps = {
    store,
    checks: createMemoryDateChecks(),
    listDatedRows: async (viewer, query) => {
      queries.push({ userId: viewer.userId, query });
      return { rows, truncated: false };
    },
    queueRun: async (automation, run) => {
      queued.push({
        name: automation.name,
        key: run.key,
        plannedFor: run.plannedFor?.toISOString(),
      });
      expect(run).toMatchObject({ kind: 'triggered', triggeredBy: null });
      expect(run.source).toEqual({ databaseId: qaReviews, rowId: run.key.split(':')[1] });
      return { jobId: randomUUID(), created: true };
    },
    actingOwner: async (automation) =>
      ownerHere ? { owner: { userId: automation.ownerUserId, name: 'Avery Lin' } } : null,
    pause: async (automation, reason) => {
      paused.push({ name: automation.name, reason });
    },
    workspaceIds: async () => [workspaceId],
  };
});

describe('checkDates', () => {
  it('queues each arrival once, at 9:00 AM the day before (AU-15)', async () => {
    await add('Review reminder', dayBefore, at('2026-10-28T14:00:00Z'));
    await check('2026-10-28T14:59:30Z');
    expect(queued).toEqual([]);
    // Asked as the owner, for the dates that can arrive since it was saved.
    expect(queries).toEqual([
      {
        userId: ownerUserId,
        query: {
          databaseId: qaReviews,
          propertyId: 'review-date',
          viewId: null,
          from: '2026-10-28',
          to: '2026-10-31',
          timeZone: denver,
        },
      },
    ]);
    await check('2026-10-28T15:00:20Z');
    await check('2026-10-28T15:00:50Z');
    expect(queued).toEqual([
      {
        name: 'Review reminder',
        key: 'date:review-1:2026-10-28T15:00:00.000Z',
        plannedFor: '2026-10-28T15:00:00.000Z',
      },
    ]);
  });

  it('follows a moved date to its new time', async () => {
    await add('Review reminder', dayBefore, at('2026-10-28T14:00:00Z'));
    await check('2026-10-28T15:00:20Z');
    // review-2 moves from Oct 30 to Oct 31, and review-1 from Oct 29 to Oct 30.
    rows = [
      { rowId: 'review-1', allDay: true, start: '2026-10-30' },
      { rowId: 'review-2', allDay: true, start: '2026-10-31' },
    ];
    await check('2026-10-29T15:00:20Z');
    await check('2026-10-30T15:00:20Z');
    expect(keys()).toEqual([
      'date:review-1:2026-10-28T15:00:00.000Z',
      'date:review-1:2026-10-29T15:00:00.000Z',
      'date:review-2:2026-10-30T15:00:00.000Z',
    ]);
  });

  it('catches up after a stop with the planned times, up to a day back (AU-05)', async () => {
    await add('Review reminder', dayBefore, at('2026-10-28T14:00:00Z'));
    await check('2026-10-28T14:30:00Z');
    // Off until 5:00 PM: the 9:00 AM arrival goes to the runner, which logs it late or missed.
    await check('2026-10-28T17:00:00Z');
    expect(queued.map(({ plannedFor }) => plannedFor)).toEqual(['2026-10-28T15:00:00.000Z']);
    // Off for two days: arrivals more than a day back are left alone.
    rows.push({ rowId: 'review-3', allDay: true, start: '2026-10-31' });
    await check('2026-10-30T16:00:00Z');
    expect(keys()).toEqual([
      'date:review-1:2026-10-28T15:00:00.000Z',
      'date:review-3:2026-10-30T15:00:00.000Z',
    ]);
  });

  it('starts again from when it was switched back on', async () => {
    const automation = await add('Review reminder', dayBefore, at('2026-10-28T14:00:00Z'));
    await check('2026-10-28T14:30:00Z');
    await store.update(workspaceId, automation.id, { enabled: false }, at('2026-10-28T14:40:00Z'));
    await check('2026-10-28T14:50:00Z');
    await store.update(workspaceId, automation.id, { enabled: true }, at('2026-10-28T15:10:00Z'));
    await check('2026-10-28T15:10:30Z');
    expect(queued).toEqual([]);
  });

  it('pauses when the owner can no longer open the database or its date property', async () => {
    await add('Review reminder', dayBefore, at('2026-10-28T14:00:00Z'));
    deps.listDatedRows = async () => null;
    await check('2026-10-28T15:00:20Z');
    expect(paused).toEqual([
      {
        name: 'Review reminder',
        reason: "Avery Lin can't open the database or its date property anymore.",
      },
    ]);
    expect(queued).toEqual([]);
  });

  it('reads nothing when its owner left or is no longer an Admin', async () => {
    await add('Review reminder', dayBefore, at('2026-10-28T14:00:00Z'));
    ownerHere = false;
    await check('2026-10-28T15:00:20Z');
    expect([queries, queued, paused]).toEqual([[], [], []]);
  });

  it('checks the others when one fails, and tries that one again next time', async () => {
    await add(
      'Broken reminder',
      { ...dayBefore, propertyId: 'broken' },
      at('2026-10-28T14:00:00Z'),
    );
    await add('Review reminder', dayBefore, at('2026-10-28T14:00:00Z'));
    const list = deps.listDatedRows;
    deps.listDatedRows = async (viewer, query) => {
      if (query.propertyId === 'broken') throw new Error('Databases is down');
      return list(viewer, query);
    };
    await expect(check('2026-10-28T15:00:20Z')).rejects.toThrow('Databases is down');
    expect(queued.map(({ name }) => name)).toEqual(['Review reminder']);
    deps.listDatedRows = list;
    await check('2026-10-28T15:00:50Z');
    expect(queued.map(({ name }) => name)).toEqual(['Review reminder', 'Broken reminder']);
  });

  it('leaves automations with other triggers alone', async () => {
    await add(
      'Intake',
      { kind: 'rowAdded', databaseId: qaReviews, includeImports: false },
      at('2026-10-28T14:00:00Z'),
    );
    await check('2026-10-28T15:00:20Z');
    expect([queries, queued]).toEqual([[], []]);
  });
});
