// Test helper: the behaviour every AutomationStore must have. Used by the memory and Postgres tests.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_AUTOMATIONS, RUNS_KEPT } from '@carehub/team-automations/automation';
import type { AutomationStore, NewAutomation, NewRun, RunOutcome } from './types';

// 9:00 AM in Denver.
const t0 = new Date('2026-10-27T15:00:00.000Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const avery = randomUUID();
const sam = randomUUID();
const qaReviews = randomUUID();
const escalations = randomUUID();

function automation(workspaceId: string, overrides: Partial<NewAutomation> = {}): NewAutomation {
  return {
    workspaceId,
    name: 'Weekday stand-up nudge',
    ownerUserId: avery,
    enabled: true,
    trigger: {
      kind: 'schedule',
      schedule: { kind: 'weekdays', time: '09:00', timeZone: 'America/Denver', endDate: null },
    },
    conditions: null,
    variables: [],
    actions: [
      {
        kind: 'sendMessage',
        recipients: [{ kind: 'role', roleId: 'agent' }],
        text: 'Good morning, {first name}!',
        pageIds: [],
      },
    ],
    nextRunAt: t0,
    ...overrides,
  };
}

const sent: RunOutcome = {
  result: 'sent',
  steps: [{ action: 0, kind: 'sendMessage', result: 'done', message: 'Messaged 12 people' }],
  recipients: 12,
  error: null,
};
const missed: RunOutcome = {
  result: 'missed',
  steps: [],
  recipients: 0,
  error: 'Missed: the server was off',
};

function run(automationId: string, overrides: Partial<NewRun> = {}): NewRun {
  const plannedFor = overrides.plannedFor ?? t0;
  return {
    automationId,
    kind: 'scheduled',
    key: `scheduled:${plannedFor.toISOString()}`,
    plannedFor,
    source: null,
    startedBy: null,
    now: t0,
    ...overrides,
  };
}

export function describeAutomationStoreContract(
  name: string,
  createStore: () => Promise<AutomationStore>,
): void {
  describe(`${name}: AutomationStore contract`, () => {
    async function setUp() {
      const store = await createStore();
      const workspaceId = randomUUID();
      const create = async (overrides: Partial<NewAutomation> = {}, now = t0) => {
        const created = await store.create(automation(workspaceId, overrides), now);
        if (!created) throw new Error('not created');
        return created;
      };
      const start = async (input: NewRun) => {
        const started = await store.startRun(input);
        if (!started) throw new Error('not started');
        return started;
      };
      return { store, workspaceId, create, start };
    }

    it('creates automations and reads them back', async () => {
      const { store, workspaceId, create } = await setUp();
      const created = await create();
      expect(created).toMatchObject({
        ...automation(workspaceId),
        pausedReason: null,
        lastRun: null,
        createdAt: t0,
        updatedAt: t0,
      });
      expect(await store.get(workspaceId, created.id)).toEqual(created);
    });

    it('keeps each workspace to itself', async () => {
      const { store, workspaceId, create } = await setUp();
      const created = await create();
      const other = randomUUID();
      expect(await store.get(other, created.id)).toBeNull();
      expect(await store.get(workspaceId, 'not-an-id')).toBeNull();
      expect(await store.list(other)).toEqual([]);
      expect(await store.update(other, created.id, { name: 'Taken over' }, at(1))).toBeNull();
      expect(await store.remove(other, created.id)).toBe(false);
      expect(await store.listRuns(other, created.id)).toEqual([]);
      expect((await store.get(workspaceId, created.id))?.name).toBe('Weekday stand-up nudge');
    });

    it('lists by name, with the database, owner and on or off filters', async () => {
      const { store, workspaceId, create } = await setUp();
      await create();
      await create({
        name: 'New QA review',
        ownerUserId: sam,
        trigger: { kind: 'rowAdded', databaseId: qaReviews, includeImports: false },
        nextRunAt: null,
      });
      await create({
        name: 'copy escalations',
        enabled: false,
        actions: [{ kind: 'addRow', databaseId: escalations, templateId: null, values: [] }],
      });
      const names = async (filter = {}) =>
        (await store.list(workspaceId, filter)).map((found) => found.name);
      expect(await names()).toEqual([
        'copy escalations',
        'New QA review',
        'Weekday stand-up nudge',
      ]);
      expect(await names({ databaseId: qaReviews })).toEqual(['New QA review']);
      expect(await names({ databaseId: escalations })).toEqual(['copy escalations']);
      expect(await names({ ownerUserId: sam })).toEqual(['New QA review']);
      expect(await names({ enabled: false })).toEqual(['copy escalations']);
      expect(await names({ enabled: true, ownerUserId: avery })).toEqual([
        'Weekday stand-up nudge',
      ]);
    });

    it(`stops at ${MAX_AUTOMATIONS} automations per workspace (AU-11)`, async () => {
      const { store, workspaceId, create } = await setUp();
      const first = await create();
      for (let i = 1; i < MAX_AUTOMATIONS; i += 1) await create({ name: `Nudge ${i}` });
      expect(await store.create(automation(workspaceId), t0)).toBeNull();
      expect(await store.create(automation(randomUUID()), t0)).not.toBeNull();
      expect(await store.remove(workspaceId, first.id)).toBe(true);
      expect(await store.create(automation(workspaceId), t0)).not.toBeNull();
      expect(await store.list(workspaceId)).toHaveLength(MAX_AUTOMATIONS);
    });

    it('changes only the fields in the patch', async () => {
      const { store, workspaceId, create } = await setUp();
      const created = await create();
      const conditions = { property: 'team', is: 'Phoenix' };
      const changed = await store.update(
        workspaceId,
        created.id,
        { name: 'Stand-up nudge', conditions, nextRunAt: null, pausedReason: 'Paused by test' },
        at(5),
      );
      expect(changed).toEqual({
        ...created,
        name: 'Stand-up nudge',
        conditions,
        nextRunAt: null,
        pausedReason: 'Paused by test',
        updatedAt: at(5),
      });
      const trigger = { kind: 'rowAdded', databaseId: qaReviews, includeImports: true } as const;
      await store.update(workspaceId, created.id, { trigger, pausedReason: null }, at(6));
      expect(await store.get(workspaceId, created.id)).toMatchObject({
        trigger,
        pausedReason: null,
      });
      expect(await store.list(workspaceId, { databaseId: qaReviews })).toHaveLength(1);
      expect(await store.update(workspaceId, randomUUID(), { name: 'Gone' }, at(7))).toBeNull();
    });

    it('deletes an automation with its runs', async () => {
      const { store, workspaceId, create, start } = await setUp();
      const created = await create();
      await start(run(created.id));
      expect(await store.remove(workspaceId, created.id)).toBe(true);
      expect(await store.get(workspaceId, created.id)).toBeNull();
      expect(await store.listRuns(workspaceId, created.id)).toEqual([]);
      expect(await store.remove(workspaceId, created.id)).toBe(false);
      expect(await store.startRun(run(created.id))).toBeNull();
    });

    it('lists due runs, soonest first, and moves each next run once', async () => {
      const { store, workspaceId, create } = await setUp();
      const nine = await create({ name: 'Nine' });
      const half = await create({ name: 'Half past', nextRunAt: at(30) });
      await create({ name: 'Off', enabled: false });
      const elsewhere = await store.create(automation(randomUUID(), { nextRunAt: at(10) }), t0);
      const due = async (now: Date, limit = 10) =>
        (await store.due(now, limit))
          .filter((found) => [nine.id, half.id, elsewhere?.id].includes(found.id))
          .map((found) => found.id);
      expect(await due(at(5))).toEqual([nine.id]);
      expect(await due(at(30))).toEqual([nine.id, elsewhere?.id, half.id]);
      expect(await store.moveNextRun(nine.id, t0, at(1440))).toBe(true);
      // Another server, a moment later, with the same planned run.
      expect(await store.moveNextRun(nine.id, t0, at(1440))).toBe(false);
      expect(await store.moveNextRun(half.id, at(30), null)).toBe(true);
      expect(await due(at(30))).toEqual([elsewhere?.id]);
      expect((await store.get(workspaceId, nine.id))?.nextRunAt).toEqual(at(1440));
    });

    it('starts one run per key (AU-06)', async () => {
      const { store, create, start } = await setUp();
      const created = await create();
      const first = await start(run(created.id));
      expect(first.created).toBe(true);
      expect(first.run).toMatchObject({
        automationId: created.id,
        workspaceId: created.workspaceId,
        kind: 'scheduled',
        plannedFor: t0,
        ranAt: t0,
        finishedAt: null,
        result: null,
        steps: [],
        recipients: 0,
        error: null,
        createdAt: t0,
      });
      const again = await start(run(created.id, { now: at(1) }));
      expect(again).toEqual({ run: first.run, created: false });
      const avery1 = await start(run(created.id, { kind: 'test', key: null, startedBy: avery }));
      const avery2 = await start(run(created.id, { kind: 'test', key: null, startedBy: avery }));
      expect(avery1.run.id).not.toBe(avery2.run.id);
      expect(await store.startRun(run(randomUUID()))).toBeNull();
    });

    it('finishes a run once and shows the last result that was not a test', async () => {
      const { store, workspaceId, create, start } = await setUp();
      const created = await create();
      const { run: started } = await start(run(created.id));
      const finished = await store.finishRun(started.id, sent, at(1));
      expect(finished).toEqual({ ...started, ...sent, finishedAt: at(1) });
      expect(await store.finishRun(started.id, sent, at(2))).toBeNull();
      expect(await store.finishRun(randomUUID(), sent, at(2))).toBeNull();
      const test = await start(run(created.id, { kind: 'test', key: null, now: at(3) }));
      await store.finishRun(test.run.id, { ...sent, result: 'failed', error: 'Timed out' }, at(4));
      expect((await store.get(workspaceId, created.id))?.lastRun).toEqual({
        result: 'sent',
        at: at(1),
      });
      const source = { databaseId: qaReviews, rowId: randomUUID() };
      const logged = await start(
        run(created.id, { plannedFor: at(5), now: at(70), source, outcome: missed }),
      );
      expect(logged.run).toMatchObject({ ...missed, source, ranAt: null, finishedAt: at(70) });
      expect((await store.list(workspaceId))[0]?.lastRun).toEqual({ result: 'missed', at: at(70) });
    });

    it('saves the steps of a running run, not of a finished one', async () => {
      const { store, create, start } = await setUp();
      const created = await create();
      const { run: started } = await start(run(created.id));
      expect(await store.saveSteps(started.id, sent.steps, 12)).toBe(true);
      const { run: again, created: isNew } = await start(run(created.id));
      expect(isNew).toBe(false);
      expect(again).toEqual({ ...started, steps: sent.steps, recipients: 12 });
      await store.finishRun(started.id, missed, at(1));
      expect(await store.saveSteps(started.id, sent.steps, 12)).toBe(false);
      expect(await store.saveSteps(randomUUID(), sent.steps, 12)).toBe(false);
    });

    it(`keeps the latest ${RUNS_KEPT} runs, newest first`, async () => {
      const { store, workspaceId, create, start } = await setUp();
      const created = await create();
      const other = await create({ name: 'Other' });
      await start(run(other.id));
      for (let i = 1; i <= RUNS_KEPT + 2; i += 1) {
        await start(run(created.id, { plannedFor: at(i), now: at(i), outcome: missed }));
      }
      const kept = await store.listRuns(workspaceId, created.id);
      expect(kept).toHaveLength(RUNS_KEPT);
      expect(kept[0]?.plannedFor).toEqual(at(RUNS_KEPT + 2));
      expect(kept.at(-1)?.plannedFor).toEqual(at(3));
      expect(await store.listRuns(workspaceId, other.id)).toHaveLength(1);
    });

    it('counts runs in each hour', async () => {
      const { store, create } = await setUp();
      const created = await create();
      const counts = [];
      for (const minutes of [0, 10, 59, 60, 61]) {
        counts.push(await store.countHourlyRun(created.id, at(minutes)));
      }
      expect(counts).toEqual([1, 2, 3, 1, 2]);
      expect(await store.countHourlyRun(randomUUID(), t0)).toBe(0);
    });
  });
}
