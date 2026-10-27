/**
 * Running automations (Automations spec, section 3: Running). Every minute the scheduler task
 * queues each planned run that's due as an `automations.run` job, and the job runs the actions
 * in order and logs the run. Each run acts as its owner, checked when it starts (access.ts), and
 * each automation runs at most RUNS_PER_HOUR times an hour.
 */
import { randomUUID } from 'node:crypto';
import type { Action, ActionKind, RunKind, RunStep } from '@carehub/team-automations/automation';
import {
  catchUp,
  MISSED_MESSAGE,
  planNextRun,
  runTiming,
} from '@carehub/team-automations/schedule';
import type { JobContext, JobFailure, ScheduleJobInput } from '../jobs';
import { NOTICE_LIMITS, type SendNoticeInput } from '../notices';
import { OWNER_LEFT, OWNER_NOT_ADMIN, pausedForOwner, type People, type Person } from './access';
import type { Automation, AutomationStore, NewRun, Run, RunOutcome } from './domain/types';

export const RUN_JOB = 'automations.run';
export const SCHEDULER_TASK = 'automations.scheduler';
/** Runs start within a minute of their time (AU-01). */
export const SCHEDULER_EVERY_MS = 60_000;
/** The first try and 3 more over about 10 minutes: the job runner waits about 1, 2 and 4 minutes. */
export const RUN_ATTEMPTS = 4;
/** Each automation runs at most this many times an hour; more are skipped (spec, Limits). */
export const RUNS_PER_HOUR = 1_000;
export const TOO_OFTEN = 'Skipped: it already ran 1,000 times this hour.';
const DUE_PER_TICK = 100;
const FAILED = 'Something went wrong.';
const MISSED: RunOutcome = { result: 'missed', steps: [], recipients: 0, error: MISSED_MESSAGE };
const skipped = (error: string): RunOutcome => ({
  result: 'skipped',
  steps: [],
  recipients: 0,
  error,
});

/** The `automations.run` job's payload: enough to find its run again on a retry. */
export interface RunJob {
  workspaceId: string;
  automationId: string;
  kind: RunKind;
  /** One run per key: `scheduled:<planned time>`, or a new `test:` or `manual:` key per click. */
  key: string;
  plannedFor: string | null;
  /** Who pressed Try it now. */
  startedBy: string | null;
}

export type QueuedRun =
  | { kind: 'scheduled'; plannedFor: Date }
  /** Try it now: Send only to me (`test`) or Send to everyone now (`manual`), new for each click. */
  | { kind: 'test' | 'manual'; startedBy: string };

/** Why a step failed, in words for the run history ("Pick at least one recipient."). Not retried. */
export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepError';
  }
}

/**
 * The owner can't open something the action uses, such as a page card's page: the step fails
 * and the automation pauses, telling the owner and the Admins (AU-20).
 */
export class AccessLost extends StepError {
  constructor(message: string) {
    super(message);
    this.name = 'AccessLost';
  }
}

export interface StepContext {
  automation: Automation;
  run: Run;
  /** The action's place in the list, from 0. */
  step: number;
  /** Who it acts as, checked when the run started: act with their access, never more. */
  owner: Person;
  /** The workspace's members when the run started. */
  people: readonly Person[];
  /** Send only to me: messages go to this person only. */
  onlyTo: string | null;
  signal: AbortSignal;
}

export interface StepDone {
  /** What it did, in plain words ("Messaged 12 people"). */
  message: string | null;
  recipients?: number;
}

/** What each kind of action does. Throw a StepError to fail the step; other errors are retried. */
export type Performers = {
  [K in ActionKind]?: (action: Extract<Action, { kind: K }>, ctx: StepContext) => Promise<StepDone>;
};
type Perform = (action: Action, ctx: StepContext) => Promise<StepDone>;

export interface AutomationRunnerOptions {
  store: AutomationStore;
  /** `scheduleJob` from features/jobs. */
  scheduleJob: (input: ScheduleJobInput<RunJob>) => Promise<{ jobId: string; created: boolean }>;
  /** `sendNotice` from features/notices: tells the owner when a run fails. */
  sendNotice: (input: SendNoticeInput) => Promise<unknown>;
  performers: Performers;
  /** The workspace's members now: each run checks its owner among them first. */
  people: People;
  log?: { warn(details: object, message: string): void };
  now?: (() => Date) | undefined;
}

export function scheduledKey(plannedFor: Date): string {
  return `scheduled:${plannedFor.toISOString()}`;
}

/** Who its notices are from: "Automation: " and the name, cut to fit the notices' limit. */
export function senderFor(name: string): string {
  const sender = `Automation: ${name}`;
  const max = NOTICE_LIMITS.sender;
  return sender.length <= max ? sender : `${sender.slice(0, max - 1)}…`;
}

/** The steps of a run that failed after `done`: the failed one, then the rest skipped. */
function failedSteps(actions: readonly Action[], done: RunStep[], message: string): RunStep[] {
  const rest = actions.slice(done.length).map((action, i): RunStep => ({
    action: done.length + i,
    kind: action.kind,
    result: i === 0 ? 'failed' : 'skipped',
    message: i === 0 ? message : null,
  }));
  return [...done, ...rest];
}

export function createAutomationRunner(options: AutomationRunnerOptions) {
  const { store, performers } = options;
  const now = options.now ?? (() => new Date());
  const warn = (details: object, message: string) => options.log?.warn(details, message);

  function newRun(job: RunJob, at: Date): NewRun {
    const { automationId, kind, key, startedBy } = job;
    const plannedFor = job.plannedFor === null ? null : new Date(job.plannedFor);
    return { automationId, kind, key, plannedFor, source: null, startedBy, now: at };
  }

  /** Queues a run as a job. With Try it now, the presser owns the job, so they can watch it. */
  function queueRun(
    automation: Automation,
    run: QueuedRun,
  ): Promise<{ jobId: string; created: boolean }> {
    const scheduled = run.kind === 'scheduled';
    const key = scheduled ? scheduledKey(run.plannedFor) : `${run.kind}:${randomUUID()}`;
    const payload: RunJob = {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      kind: run.kind,
      key,
      plannedFor: scheduled ? run.plannedFor.toISOString() : null,
      startedBy: scheduled ? null : run.startedBy,
    };
    return options.scheduleJob({
      kind: RUN_JOB,
      key: `${automation.id}:${key}`,
      payload,
      workspaceId: automation.workspaceId,
      ...(scheduled ? {} : { ownerUserId: run.startedBy }),
    });
  }

  /**
   * Logs the due automation's runs that are an hour late or more as missed, queues the latest
   * one that isn't (AU-05), then moves its next run on, 15 minutes at least. Each step can
   * happen twice (a restart halfway): runs have keys, so it still gives one run each (AU-06).
   */
  async function planDue(automation: Automation, at: Date): Promise<void> {
    const { trigger, nextRunAt } = automation;
    if (trigger.kind !== 'schedule' || !nextRunAt) return;
    const { missed, due, next } = catchUp(trigger.schedule, nextRunAt, at);
    // Runs are at least 15 minutes apart, so of several due runs only the latest happens.
    const latest = due.pop();
    for (const plannedFor of [...missed, ...due]) {
      await store.startRun({
        automationId: automation.id,
        kind: 'scheduled',
        key: scheduledKey(plannedFor),
        plannedFor,
        source: null,
        startedBy: null,
        now: at,
        outcome: MISSED,
      });
    }
    if (latest) await queueRun(automation, { kind: 'scheduled', plannedFor: latest });
    const following = latest ? planNextRun(trigger.schedule, at, at) : next;
    const moved = await store.moveNextRun(automation.id, nextRunAt, following);
    // A Once automation switches itself off once its run is queued or missed (AU-08).
    if (moved && following === null && trigger.schedule.kind === 'once') {
      await store.update(automation.workspaceId, automation.id, { enabled: false }, at);
    }
  }

  /** The scheduler task: plans each due automation, one at a time across servers. */
  async function tick(ctx?: { signal: AbortSignal; now?: Date }): Promise<void> {
    const at = ctx?.now ?? now();
    for (const automation of await store.due(at, DUE_PER_TICK)) {
      if (ctx?.signal.aborted) return;
      try {
        await planDue(automation, at);
      } catch (error) {
        warn({ err: error, automationId: automation.id }, 'automations: planning a run failed');
      }
    }
  }

  /** Sends a 🔔 notice from the automation. A failed notice is only logged. */
  async function tell(
    automation: Automation,
    userId: string,
    words: { title: string; text?: string | null; link?: string },
  ): Promise<void> {
    try {
      await options.sendNotice({
        workspaceId: automation.workspaceId,
        userId,
        kind: 'automation',
        sender: senderFor(automation.name),
        title: words.title,
        ...(words.text ? { text: words.text } : {}),
        ...(words.link
          ? { buttons: [{ label: words.link, href: `/settings/automations/${automation.id}` }] }
          : {}),
      });
    } catch (err) {
      warn({ err, automationId: automation.id }, 'automations: a notice failed');
    }
  }

  /** Tells the owner that a run failed (AU-07). */
  function tellOwner(automation: Automation, error: string | null): Promise<void> {
    const words = { title: 'An automation failed', text: error, link: 'See its runs' };
    return tell(automation, automation.ownerUserId, words);
  }

  /**
   * Switches it off, saying why ("Paused: …"). If it was on, the Admins are told, and the owner
   * too while they're still here (spec, Running; AU-20).
   */
  async function pause(automation: Automation, reason: string, people: readonly Person[]) {
    const patch = { enabled: false, nextRunAt: null, pausedReason: reason };
    const paused = await store.update(automation.workspaceId, automation.id, patch, now());
    if (!paused || !automation.enabled) return;
    const title =
      reason === OWNER_LEFT ? 'An automation was switched off' : 'An automation was paused';
    const fix = pausedForOwner(reason)
      ? 'Switch it back on to become its owner.'
      : "Switch it back on once that's fixed.";
    for (const person of people) {
      if (person.isAdmin) {
        await tell(automation, person.userId, { title, text: `${reason} ${fix}`, link: 'Open it' });
      } else if (person.userId === automation.ownerUserId) {
        // Only an owner who isn't an Admin anymore gets here.
        const text =
          "You aren't an Admin anymore, so it was paused. An Admin can switch it back on.";
        await tell(automation, person.userId, { title, text });
      }
    }
  }

  /**
   * The owner it acts as and the members, checked now (spec, section 5). Null when the run
   * can't go ahead: it's then logged, and an automation whose owner left or isn't an Admin
   * anymore is paused.
   */
  async function checkOwner(automation: Automation, run: Run, ctx: JobContext) {
    let people: readonly Person[];
    try {
      people = await options.people(automation.workspaceId);
    } catch (error) {
      // As with steps: a StepError is final, anything else is tried again.
      const final = error instanceof StepError;
      if (ctx.signal.aborted || (!final && ctx.attempt < RUN_ATTEMPTS)) throw error;
      const message = final ? error.message : FAILED;
      await finish(automation, run, { result: 'failed', steps: [], recipients: 0, error: message });
      return null;
    }
    const owner = people.find((person) => person.userId === automation.ownerUserId);
    if (owner?.isAdmin) return { owner, people };
    const reason = owner ? OWNER_NOT_ADMIN : OWNER_LEFT;
    await store.finishRun(run.id, skipped(reason), now());
    await pause(automation, reason, people);
    return null;
  }

  /**
   * Runs the actions after the ones an earlier try did, in order; a failed step stops the rest.
   * `lostAccess` says why it must pause, when the owner couldn't open something it uses.
   */
  async function runSteps(
    automation: Automation,
    run: Run,
    job: RunJob,
    ctx: JobContext,
    acting: { owner: Person; people: readonly Person[] },
  ): Promise<{ outcome: RunOutcome; lostAccess: string | null }> {
    const steps = [...run.steps];
    let recipients = run.recipients;
    const onlyTo = job.kind === 'test' ? job.startedBy : null;
    const { signal } = ctx;
    for (const [index, action] of automation.actions.entries()) {
      if (index < steps.length) continue;
      ctx.signal.throwIfAborted();
      try {
        const perform = performers[action.kind] as Perform | undefined;
        if (!perform) throw new StepError("This action can't run yet.");
        const step = { automation, run, step: index, ...acting, onlyTo, signal };
        const done = await perform(action, step);
        recipients += done.recipients ?? 0;
        steps.push({ action: index, kind: action.kind, result: 'done', message: done.message });
        await store.saveSteps(run.id, steps, recipients);
      } catch (error) {
        // Stopped (timeout, cancel or shutdown): the job runner decides what happens next.
        if (ctx.signal.aborted) throw error;
        const final = error instanceof StepError;
        // Anything else may pass, such as the database being away: the job tries again.
        if (!final && ctx.attempt < RUN_ATTEMPTS) throw error;
        if (!final) warn({ err: error, automationId: automation.id }, 'automations: a step failed');
        const message = final ? error.message : FAILED;
        const outcome: RunOutcome = {
          result: 'failed',
          steps: failedSteps(automation.actions, steps, message),
          recipients,
          error: message,
        };
        return { outcome, lostAccess: error instanceof AccessLost ? message : null };
      }
    }
    return { outcome: { result: 'sent', steps, recipients, error: null }, lostAccess: null };
  }

  /** Finishes the run and tells the owner when it failed, except for Send only to me. */
  async function finish(automation: Automation, run: Run, outcome: RunOutcome): Promise<void> {
    const finished = await store.finishRun(run.id, outcome, now());
    if (finished?.result === 'failed' && run.kind !== 'test') {
      await tellOwner(automation, finished.error);
    }
  }

  /** The `automations.run` job. Jobs run at least once, so a run's key and saved steps keep it to one. */
  async function runJob(job: RunJob, ctx: JobContext): Promise<void> {
    const automation = await store.get(job.workspaceId, job.automationId);
    if (!automation) return;
    const input = newRun(job, now());
    // Started an hour late or more (the server was off): logged as missed instead (AU-05).
    const late =
      input.plannedFor !== null && runTiming(input.plannedFor, input.now).kind === 'missed';
    const started = await store.startRun(late ? { ...input, outcome: MISSED } : input);
    if (!started || started.run.result !== null) return;
    const { run } = started;
    // Counted once per run, not per try. The owner hears about the first run over the limit.
    if (started.created) {
      const count = await store.countHourlyRun(automation.id, input.now);
      if (count > RUNS_PER_HOUR) {
        await store.finishRun(run.id, skipped(TOO_OFTEN), now());
        if (count === RUNS_PER_HOUR + 1) {
          await tell(automation, automation.ownerUserId, {
            title: 'An automation ran too often',
            text: 'It ran 1,000 times this hour, so more runs are skipped until the hour is up.',
            link: 'See its runs',
          });
        }
        return;
      }
    }
    const acting = await checkOwner(automation, run, ctx);
    if (!acting) return;
    const { outcome, lostAccess } = await runSteps(automation, run, job, ctx, acting);
    if (!lostAccess) return finish(automation, run, outcome);
    // Pausing tells the owner and the Admins, instead of the failed-run notice.
    await store.finishRun(run.id, outcome, now());
    await pause(automation, lostAccess, acting.people);
  }

  /** The job failed for good without logging its run: it took too long or stopped responding. */
  async function jobFailed(job: RunJob, failure: JobFailure): Promise<void> {
    const automation = await store.get(job.workspaceId, job.automationId);
    const started = automation ? await store.startRun(newRun(job, now())) : null;
    if (!automation || !started || started.run.result !== null) return;
    const { run } = started;
    const steps = failedSteps(automation.actions, run.steps, failure.error);
    const outcome: RunOutcome = {
      result: 'failed',
      steps,
      recipients: run.recipients,
      error: failure.error,
    };
    await finish(automation, run, outcome);
  }

  return { tick, queueRun, runJob, jobFailed };
}

export type AutomationRunner = ReturnType<typeof createAutomationRunner>;
