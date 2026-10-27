import { randomUUID } from 'node:crypto';
import type { Action } from '@carehub/team-automations/automation';
import { describeRunTiming, runTiming, type Schedule } from '@carehub/team-automations/schedule';
import { describe, expect, it } from 'vitest';
import type { JobContext, ScheduleJobInput } from '../jobs';
import type { SendNoticeInput } from '../notices';
import { OWNER_LEFT, OWNER_NOT_ADMIN, type Person } from './access';
import { createMemoryAutomationStore } from './domain/memoryStore';
import type { NewAutomation } from './domain/types';
import {
  AccessLost,
  createAutomationRunner,
  RUN_ATTEMPTS,
  RUN_JOB,
  RUNS_PER_HOUR,
  senderFor,
  StepError,
  TOO_OFTEN,
  type Performers,
  type RunJob,
  type StepContext,
} from './running';

const workspaceId = randomUUID();
const avery = randomUUID();
const riley = randomUUID();
const jordan = randomUUID();
const averyLin: Person = { userId: avery, name: 'Avery Lin', roleId: 'admin', isAdmin: true };
const rileyChen: Person = { userId: riley, name: 'Riley Chen', roleId: 'agent', isAdmin: false };
const jordanWu: Person = { userId: jordan, name: 'Jordan Wu', roleId: 'admin', isAdmin: true };
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
  // The workspace's members; tests change it to make the owner leave or lose Admin.
  const members: Person[] = [averyLin, rileyChen, jordanWu];
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
    people: async (id) => (id === workspaceId ? members : []),
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
  return { store, jobs, notices, members, runner, create, job, ctx, runs, setClock };
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

describe('acting as its owner', () => {
  it('gives each step the owner and the members, checked when the run starts', async () => {
    const seen: StepContext[] = [];
    const { runner, create, job, ctx } = setUp({
      sendMessage: async (_action, context) => {
        seen.push(context);
        return messaged();
      },
    });
    await create();
    await runner.tick();
    await runner.runJob(job(), ctx());
    expect(seen.map((context) => context.owner)).toEqual([averyLin]);
    expect(seen[0]?.people).toEqual([averyLin, rileyChen, jordanWu]);
  });

  it('switches off when its owner left, logs the run as skipped and tells the Admins', async () => {
    let sends = 0;
    const { store, runner, notices, members, create, job, ctx, runs } = setUp({
      sendMessage: async () => {
        sends += 1;
        return messaged();
      },
    });
    const automation = await create();
    await runner.tick();
    members.splice(0, 1);
    await runner.runJob(job(), ctx());
    expect(sends).toBe(0);
    expect(await runs(automation.id)).toMatchObject([{ result: 'skipped', error: OWNER_LEFT }]);
    expect(await store.get(workspaceId, automation.id)).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: OWNER_LEFT,
    });
    expect(notices).toEqual([
      {
        workspaceId,
        userId: jordan,
        kind: 'automation',
        sender: 'Automation: Weekday stand-up nudge',
        title: 'An automation was switched off',
        text: `${OWNER_LEFT} Switch it back on to become its owner.`,
        buttons: [{ label: 'Open it', href: `/settings/automations/${automation.id}` }],
      },
    ]);
  });

  it("pauses when its owner isn't an Admin anymore, telling them and the Admins", async () => {
    const { store, runner, notices, members, create, job, ctx, runs } = setUp();
    const automation = await create();
    await runner.tick();
    members[0] = { ...averyLin, roleId: 'agent', isAdmin: false };
    await runner.runJob(job(), ctx());
    expect(await runs(automation.id)).toMatchObject([
      { result: 'skipped', error: OWNER_NOT_ADMIN },
    ]);
    expect((await store.get(workspaceId, automation.id))?.pausedReason).toBe(OWNER_NOT_ADMIN);
    expect(notices).toMatchObject([
      {
        userId: avery,
        title: 'An automation was paused',
        text: "You aren't an Admin anymore, so it was paused. An Admin can switch it back on.",
      },
      {
        userId: jordan,
        title: 'An automation was paused',
        text: `${OWNER_NOT_ADMIN} Switch it back on to become its owner.`,
        buttons: [{ label: 'Open it' }],
      },
    ]);
    expect(notices[0]).not.toHaveProperty('buttons');
  });

  it('pauses when a step finds its owner lost access, without the failed-run notice (AU-20)', async () => {
    const { store, runner, notices, create, job, ctx, runs } = setUp({
      sendMessage: async () => {
        throw new AccessLost("Avery Lin can't open one of its pages anymore.");
      },
    });
    const automation = await create();
    await runner.tick();
    await runner.runJob(job(), ctx());
    const reason = "Avery Lin can't open one of its pages anymore.";
    expect(await runs(automation.id)).toMatchObject([
      { result: 'failed', error: reason, steps: [{ result: 'failed', message: reason }] },
    ]);
    expect(await store.get(workspaceId, automation.id)).toMatchObject({
      enabled: false,
      pausedReason: reason,
    });
    expect(notices.map((notice) => [notice.userId, notice.title, notice.text])).toEqual([
      [avery, 'An automation was paused', `${reason} Switch it back on once that's fixed.`],
      [jordan, 'An automation was paused', `${reason} Switch it back on once that's fixed.`],
    ]);
  });

  it("doesn't tell anyone again when it was already off", async () => {
    const { runner, notices, members, create, job, ctx, runs } = setUp();
    const automation = await create({ enabled: false, nextRunAt: null });
    members.splice(0, 1);
    await runner.queueRun(automation, { kind: 'test', startedBy: jordan });
    await runner.runJob(job(), ctx());
    expect(await runs(automation.id)).toMatchObject([{ kind: 'test', result: 'skipped' }]);
    expect(notices).toEqual([]);
  });

  it("fails at once when it can't check its owner, and tries again when the list is away", async () => {
    const failing = setUp();
    const runner = createAutomationRunner({
      store: failing.store,
      scheduleJob: async () => ({ jobId: 'job-1', created: true }),
      sendNotice: async (input) => {
        failing.notices.push(input);
      },
      performers: { sendMessage: messaged },
      people: async () => {
        throw new StepError("Couldn't check its owner's access.");
      },
      now: () => nine,
    });
    const automation = await failing.create();
    await failing.runner.tick();
    await runner.runJob(failing.job(), failing.ctx());
    expect(await failing.runs(automation.id)).toMatchObject([
      { result: 'failed', error: "Couldn't check its owner's access.", steps: [] },
    ]);
    expect(failing.notices).toMatchObject([{ userId: avery, title: 'An automation failed' }]);

    const away = setUp();
    const retried = createAutomationRunner({
      store: away.store,
      scheduleJob: async () => ({ jobId: 'job-1', created: true }),
      sendNotice: async () => {},
      performers: { sendMessage: messaged },
      people: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      now: () => nine,
    });
    await away.create();
    await away.runner.tick();
    await expect(retried.runJob(away.job(), away.ctx(1))).rejects.toThrow('ECONNREFUSED');
  });
});

describe('the hourly limit', () => {
  it('skips runs over 1,000 an hour, logs them and tells the owner once', async () => {
    const { store, runner, notices, create, job, ctx, runs, setClock } = setUp();
    const automation = await create({ enabled: false, nextRunAt: null });
    for (let n = 0; n < RUNS_PER_HOUR - 1; n += 1) await store.countHourlyRun(automation.id, nine);
    for (let n = 0; n < 3; n += 1) {
      setClock(minutes(n));
      await runner.queueRun(automation, { kind: 'manual', startedBy: avery });
      await runner.runJob(job(n), ctx());
    }
    const kept = await runs(automation.id);
    expect(kept.map((run) => [run.result, run.error])).toEqual([
      ['skipped', TOO_OFTEN],
      ['skipped', TOO_OFTEN],
      ['sent', null],
    ]);
    expect(notices).toEqual([
      {
        workspaceId,
        userId: avery,
        kind: 'automation',
        sender: 'Automation: Weekday stand-up nudge',
        title: 'An automation ran too often',
        text: 'It ran 1,000 times this hour, so more runs are skipped until the hour is up.',
        buttons: [{ label: 'See its runs', href: `/settings/automations/${automation.id}` }],
      },
    ]);
  });

  it('counts a run once, not once per try', async () => {
    let tries = 0;
    const { store, runner, create, job, ctx } = setUp({
      sendMessage: async () => {
        tries += 1;
        if (tries === 1) throw new Error('connect ECONNREFUSED');
        return messaged();
      },
    });
    const automation = await create();
    await runner.tick();
    await expect(runner.runJob(job(), ctx(1))).rejects.toThrow('ECONNREFUSED');
    await runner.runJob(job(), ctx(2));
    expect(await store.countHourlyRun(automation.id, nine)).toBe(2);
  });
});

describe('the scheduler task', () => {
  it('plans with the time the jobs runner gives it', async () => {
    const { jobs, runner, create } = setUp();
    await create({ nextRunAt: wednesday });
    await runner.tick({ signal: new AbortController().signal, now: wednesday });
    expect(jobs.map((queued) => queued.payload.plannedFor)).toEqual([wednesday.toISOString()]);
  });
});
