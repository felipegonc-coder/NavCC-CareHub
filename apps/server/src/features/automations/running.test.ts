import { randomUUID } from 'node:crypto';
import type { Action } from '@carehub/team-automations/automation';
import { describeRunTiming, runTiming, type Schedule } from '@carehub/team-automations/schedule';
import { describe, expect, it } from 'vitest';
import type { JobContext, ScheduleJobInput } from '../jobs';
import type { SendNoticeInput } from '../notices';
import { createMemoryAutomationStore } from './domain/memoryStore';
import type { NewAutomation } from './domain/types';
import {
  createAutomationRunner,
  RUN_ATTEMPTS,
  RUN_JOB,
  senderFor,
  StepError,
  type Performers,
  type RunJob,
  type StepContext,
} from './running';

const workspaceId = randomUUID();
const avery = randomUUID();
const riley = randomUUID();
// Tuesday, Oct 27, 2026, 9:00 AM in Denver, and the next weekday's.
const nine = new Date('2026-10-27T15:00:00.000Z');
const wednesday = new Date('2026-10-28T15:00:00.000Z');
const minutes = (n: number) => new Date(nine.getTime() + n * 60_000);

const message: Action = {
  kind: 'sendMessage',
  recipients: [{ kind: 'role', roleId: 'agent' }],
  text: 'Good morning, {first name}!',
  pageIds: [],
};
const addRow: Action = { kind: 'addRow', databaseId: randomUUID(), templateId: null, values: [] };
const messaged = async () => ({ message: 'Messaged 3 people', recipients: 3 });

function standUp(overrides: Partial<NewAutomation>): NewAutomation {
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
    actions: [message],
    nextRunAt: nine,
    ...overrides,
  };
}

function setUp(performers: Performers = { sendMessage: messaged }) {
  const store = createMemoryAutomationStore();
  const jobs: ScheduleJobInput<RunJob>[] = [];
  const notices: SendNoticeInput[] = [];
  let clock = nine;
  const runner = createAutomationRunner({
    store,
    scheduleJob: async (input) => {
      jobs.push(input);
      return { jobId: `job-${jobs.length}`, created: true };
    },
    sendNotice: async (input) => {
      notices.push(input);
    },
    performers,
    now: () => clock,
  });
  async function create(overrides: Partial<NewAutomation> = {}) {
    const created = await store.create(standUp(overrides), minutes(-24 * 60));
    if (!created) throw new Error('not created');
    return created;
  }
  /** The payload of the n-th queued job. */
  function job(n = 0): RunJob {
    const queued = jobs[n];
    if (!queued) throw new Error(`no job ${n}`);
    return queued.payload;
  }
  const ctx = (attempt = 1): JobContext => ({
    jobId: 'job-1',
    attempt,
    lateByMs: 0,
    signal: new AbortController().signal,
    setProgress: () => {},
  });
  const runs = (automationId: string) => store.listRuns(workspaceId, automationId);
  const setClock = (at: Date) => {
    clock = at;
  };
  return { store, jobs, notices, runner, create, job, ctx, runs, setClock };
}

describe('the scheduler', () => {
  it('queues a due run once and moves the next run to the next weekday (AU-01)', async () => {
    const { store, jobs, runner, create } = setUp();
    const automation = await create();
    await runner.tick();
    await runner.tick();
    const key = 'scheduled:2026-10-27T15:00:00.000Z';
    expect(jobs).toEqual([
      {
        kind: RUN_JOB,
        key: `${automation.id}:${key}`,
        payload: {
          workspaceId,
          automationId: automation.id,
          kind: 'scheduled',
          key,
          plannedFor: nine.toISOString(),
          startedBy: null,
        },
        workspaceId,
      },
    ]);
    expect((await store.get(workspaceId, automation.id))?.nextRunAt).toEqual(wednesday);
  });

  it('runs a run up to an hour late, marked late, and logs older ones as missed (AU-05)', async () => {
    const { store, jobs, runner, create, job, ctx, runs, setClock } = setUp();
    const late = await create();
    setClock(minutes(20));
    await runner.tick();
    await runner.runJob(job(), ctx());
    const [ran] = await runs(late.id);
    expect(ran).toMatchObject({ result: 'sent', plannedFor: nine, ranAt: minutes(20) });
    expect(describeRunTiming(runTiming(nine, minutes(20)))).toBe('Ran 20 minutes late');

    const missed = await create({ name: 'Back at 11' });
    setClock(minutes(120));
    await runner.tick();
    expect(jobs).toHaveLength(1);
    expect(await runs(missed.id)).toMatchObject([
      { result: 'missed', error: 'Missed: the server was off', plannedFor: nine, ranAt: null },
    ]);
    expect((await store.get(workspaceId, missed.id))?.nextRunAt).toEqual(wednesday);
  });

  it('switches a Once automation off when its run is queued, and still runs it (AU-08)', async () => {
    const { store, runner, create, job, ctx, runs } = setUp();
    const schedule: Schedule = {
      kind: 'once',
      date: '2026-10-27',
      time: '09:00',
      timeZone: 'America/Denver',
    };
    const once = await create({ trigger: { kind: 'schedule', schedule } });
    await runner.tick();
    expect(await store.get(workspaceId, once.id)).toMatchObject({
      enabled: false,
      nextRunAt: null,
    });
    await runner.runJob(job(), ctx());
    expect(await runs(once.id)).toMatchObject([{ kind: 'scheduled', result: 'sent' }]);
  });
});

describe('the run job', () => {
  it('runs the actions once, even when the job runs twice (AU-06)', async () => {
    let sends = 0;
    const { store, runner, create, job, ctx, runs, setClock } = setUp({
      sendMessage: async () => {
        sends += 1;
        return messaged();
      },
    });
    const automation = await create();
    await runner.tick();
    setClock(minutes(0.1));
    await runner.runJob(job(), ctx());
    await runner.runJob(job(), ctx());
    expect(sends).toBe(1);
    expect(await runs(automation.id)).toMatchObject([
      {
        kind: 'scheduled',
        plannedFor: nine,
        ranAt: minutes(0.1),
        result: 'sent',
        recipients: 3,
        error: null,
        steps: [{ action: 0, kind: 'sendMessage', result: 'done', message: 'Messaged 3 people' }],
      },
    ]);
    expect((await store.get(workspaceId, automation.id))?.lastRun).toEqual({
      result: 'sent',
      at: minutes(0.1),
    });
  });

  it('logs a run whose job starts an hour late as missed, without running it', async () => {
    let sends = 0;
    const { runner, create, job, ctx, runs, setClock } = setUp({
      sendMessage: async () => {
        sends += 1;
        return messaged();
      },
    });
    const automation = await create();
    await runner.tick();
    setClock(minutes(61));
    await runner.runJob(job(), ctx());
    expect(sends).toBe(0);
    expect(await runs(automation.id)).toMatchObject([{ result: 'missed', ranAt: null }]);
  });

  it('tries 3 more times, then logs Failed and tells the owner (AU-07)', async () => {
    const { runner, notices, create, job, ctx, runs } = setUp({
      sendMessage: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const automation = await create();
    await runner.tick();
    for (let attempt = 1; attempt < RUN_ATTEMPTS; attempt += 1) {
      await expect(runner.runJob(job(), ctx(attempt))).rejects.toThrow('ECONNREFUSED');
    }
    expect(notices).toHaveLength(0);
    await runner.runJob(job(), ctx(RUN_ATTEMPTS));
    expect(await runs(automation.id)).toMatchObject([
      {
        result: 'failed',
        error: 'Something went wrong.',
        steps: [
          { action: 0, kind: 'sendMessage', result: 'failed', message: 'Something went wrong.' },
        ],
      },
    ]);
    expect(notices).toEqual([
      {
        workspaceId,
        userId: avery,
        kind: 'automation',
        sender: 'Automation: Weekday stand-up nudge',
        title: 'An automation failed',
        text: 'Something went wrong.',
        buttons: [{ label: 'See its runs', href: `/settings/automations/${automation.id}` }],
      },
    ]);
  });

  it('cuts a long name to fit who the notice is from', () => {
    expect(senderFor('Weekday stand-up nudge')).toBe('Automation: Weekday stand-up nudge');
    const sender = senderFor('A'.repeat(100));
    expect(sender).toHaveLength(100);
    expect(sender.endsWith('A…')).toBe(true);
  });

  it('stops at a failed step and shows which one failed (AU-18)', async () => {
    let added = 0;
    const { runner, notices, create, job, ctx, runs } = setUp({
      sendMessage: async () => {
        throw new StepError('Pick at least one recipient.');
      },
      addRow: async () => {
        added += 1;
        return { message: 'Added a row' };
      },
    });
    const automation = await create({ actions: [message, addRow] });
    await runner.tick();
    await runner.runJob(job(), ctx());
    expect(added).toBe(0);
    expect(await runs(automation.id)).toMatchObject([
      {
        result: 'failed',
        error: 'Pick at least one recipient.',
        steps: [
          {
            action: 0,
            kind: 'sendMessage',
            result: 'failed',
            message: 'Pick at least one recipient.',
          },
          { action: 1, kind: 'addRow', result: 'skipped', message: null },
        ],
      },
    ]);
    expect(notices).toMatchObject([{ userId: avery, text: 'Pick at least one recipient.' }]);
  });

  it("fails a step whose action can't run yet", async () => {
    const { runner, create, job, ctx, runs } = setUp({});
    const automation = await create();
    await runner.tick();
    await runner.runJob(job(), ctx());
    expect(await runs(automation.id)).toMatchObject([
      { result: 'failed', error: "This action can't run yet." },
    ]);
  });

  it('carries on after the steps an earlier try did', async () => {
    let sends = 0;
    let adds = 0;
    const { runner, create, job, ctx, runs } = setUp({
      sendMessage: async () => {
        sends += 1;
        return messaged();
      },
      addRow: async () => {
        adds += 1;
        if (adds === 1) throw new Error('connection reset');
        return { message: 'Added a row' };
      },
    });
    const automation = await create({ actions: [message, addRow] });
    await runner.tick();
    await expect(runner.runJob(job(), ctx(1))).rejects.toThrow('connection reset');
    await runner.runJob(job(), ctx(2));
    expect({ sends, adds }).toEqual({ sends: 1, adds: 2 });
    expect(await runs(automation.id)).toMatchObject([
      {
        result: 'sent',
        recipients: 3,
        steps: [
          { action: 0, result: 'done', message: 'Messaged 3 people' },
          { action: 1, result: 'done', message: 'Added a row' },
        ],
      },
    ]);
  });

  it('logs the run as failed when the job fails for good, and tells the owner once', async () => {
    const { runner, notices, create, job, ctx, runs } = setUp({
      sendMessage: messaged,
      addRow: async () => {
        throw new Error('stuck');
      },
    });
    const automation = await create({ actions: [message, addRow] });
    await runner.tick();
    await expect(runner.runJob(job(), ctx(1))).rejects.toThrow('stuck');
    const failure = { jobId: 'job-1', attempts: 2, error: 'The job took too long.' };
    await runner.jobFailed(job(), failure);
    await runner.jobFailed(job(), failure);
    expect(await runs(automation.id)).toMatchObject([
      {
        result: 'failed',
        error: 'The job took too long.',
        steps: [
          { action: 0, result: 'done' },
          { action: 1, kind: 'addRow', result: 'failed', message: 'The job took too long.' },
        ],
      },
    ]);
    expect(notices).toHaveLength(1);
  });
});

describe('Try it now', () => {
  it('Send only to me messages only the presser, marked Test, and tells no one if it fails (AU-04)', async () => {
    const seen: StepContext[] = [];
    const { runner, jobs, notices, create, job, ctx, runs } = setUp({
      sendMessage: async (_action, context) => {
        seen.push(context);
        throw new StepError('Pick at least one recipient.');
      },
    });
    const automation = await create();
    await runner.queueRun(automation, { kind: 'test', startedBy: riley });
    expect(jobs[0]).toMatchObject({ kind: RUN_JOB, workspaceId, ownerUserId: riley });
    expect(job().key).toMatch(/^test:[0-9a-f-]{36}$/);
    await runner.runJob(job(), ctx());
    expect(seen.map((context) => context.onlyTo)).toEqual([riley]);
    expect(await runs(automation.id)).toMatchObject([
      { kind: 'test', startedBy: riley, plannedFor: null, result: 'failed' },
    ]);
    expect(notices).toHaveLength(0);
  });

  it('Send to everyone now makes one run per click', async () => {
    const { runner, create, job, ctx, runs } = setUp();
    const automation = await create({ enabled: false, nextRunAt: null });
    await runner.queueRun(automation, { kind: 'manual', startedBy: avery });
    await runner.queueRun(automation, { kind: 'manual', startedBy: avery });
    expect(job(0).key).not.toBe(job(1).key);
    await runner.runJob(job(0), ctx());
    await runner.runJob(job(1), ctx());
    const kept = await runs(automation.id);
    expect(kept.map((run) => [run.kind, run.result])).toEqual([
      ['manual', 'sent'],
      ['manual', 'sent'],
    ]);
  });
});
