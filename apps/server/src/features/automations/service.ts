import { httpError } from '../../core/errors';
import { MAX_AUTOMATIONS, type Trigger } from '@carehub/team-automations/automation';
import { planNextRun } from '@carehub/team-automations/schedule';
import {
  automationChanges,
  automationInput,
  automationListQuery,
  automationProblems,
  type Problem,
} from '@carehub/team-automations/validate';
import type { Automation, AutomationPatch, AutomationStore, Run } from './domain/types';

/** An Admin of the workspace (the routes check that first). */
export interface Caller {
  workspaceId: string;
  userId: string;
}

export interface AutomationsServiceOptions {
  store: AutomationStore;
  now?: (() => Date) | undefined;
}

export interface AutomationsService {
  list(caller: Caller, query: unknown): Promise<Automation[]>;
  get(caller: Caller, id: string): Promise<Automation>;
  /** The caller becomes the owner. */
  create(caller: Caller, body: unknown): Promise<Automation>;
  update(caller: Caller, id: string, body: unknown): Promise<Automation>;
  remove(caller: Caller, id: string): Promise<void>;
  runs(caller: Caller, id: string): Promise<Run[]>;
}

/** Scheduled automations that are on have a next run; everything else has none. */
export function nextRunFor(
  automation: { enabled: boolean; trigger: Trigger },
  now: Date,
  lastRanAt: Date | null,
): Date | null {
  const { enabled, trigger } = automation;
  return enabled && trigger.kind === 'schedule'
    ? planNextRun(trigger.schedule, now, lastRanAt)
    : null;
}

/** 400 with each save error on its field, in the shape of the app's zod errors. */
function reject(problems: Problem[]): void {
  const [first] = problems;
  if (!first) return;
  const details = problems.map(({ path, message }) => ({ code: 'custom', path, message }));
  throw httpError(400, 'invalid', first.message, details);
}

/** Managing automations: list, create, change, delete and run history (spec, section 2). */
export function createAutomationsService(options: AutomationsServiceOptions): AutomationsService {
  const { store } = options;
  const now = options.now ?? (() => new Date());

  async function found(caller: Caller, id: string): Promise<Automation> {
    const automation = await store.get(caller.workspaceId, id);
    if (!automation) throw httpError(404, 'not_found');
    return automation;
  }

  /** When the latest scheduled run started: the next one waits 15 minutes after it. */
  async function lastScheduledRun(caller: Caller, id: string): Promise<Date | null> {
    const runs = await store.listRuns(caller.workspaceId, id);
    const last = runs.find((run) => run.kind === 'scheduled' && run.ranAt !== null);
    return last?.ranAt ?? null;
  }

  return {
    async list(caller, query) {
      return store.list(caller.workspaceId, automationListQuery.parse(query ?? {}));
    },

    get: found,

    async create(caller, body) {
      const input = automationInput.parse(body);
      const at = now();
      reject(automationProblems(input, at));
      const created = await store.create(
        {
          ...input,
          workspaceId: caller.workspaceId,
          ownerUserId: caller.userId,
          nextRunAt: nextRunFor(input, at, null),
        },
        at,
      );
      if (!created) {
        throw httpError(
          413,
          'too_large',
          `A workspace can have up to ${MAX_AUTOMATIONS} automations. Delete one to add another.`,
        );
      }
      return created;
    },

    async update(caller, id, body) {
      const changes = automationChanges.parse(body);
      const current = await found(caller, id);
      const patch: AutomationPatch = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      );
      const merged = { ...current, ...patch };
      const at = now();
      reject(automationProblems(merged, at));
      if (patch.trigger !== undefined || patch.enabled !== undefined) {
        const scheduled = merged.enabled && merged.trigger.kind === 'schedule';
        const lastRanAt = scheduled ? await lastScheduledRun(caller, id) : null;
        patch.nextRunAt = nextRunFor(merged, at, lastRanAt);
      }
      // Switching it back on clears why the server paused it.
      if (patch.enabled === true) patch.pausedReason = null;
      const updated = await store.update(caller.workspaceId, id, patch, at);
      if (!updated) throw httpError(404, 'not_found');
      return updated;
    },

    async remove(caller, id) {
      if (!(await store.remove(caller.workspaceId, id))) throw httpError(404, 'not_found');
    },

    async runs(caller, id) {
      await found(caller, id);
      return store.listRuns(caller.workspaceId, id);
    },
  };
}
