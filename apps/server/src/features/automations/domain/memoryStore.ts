import { randomUUID } from 'node:crypto';
import { databasesUsed, MAX_AUTOMATIONS, RUNS_KEPT } from '@carehub/team-automations/automation';
import type { Automation, AutomationStore, Run } from './types';

type Stored = Omit<Automation, 'lastRun'>;

const HOUR_MS = 3_600_000;
// Copies in and out, as a database would.
const copy = <T>(value: T): T => structuredClone(value);
// A to Z ignoring case, by code point, like ORDER BY lower(name) COLLATE "C".
const byName = (a: Stored, b: Stored) => {
  const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()];
  return x < y ? -1 : x > y ? 1 : 0;
};
const byLatest = (a: Run, b: Run) =>
  b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);

/** An AutomationStore in memory, for unit tests. It passes the same contract as the Postgres one. */
export function createMemoryAutomationStore(): AutomationStore {
  const automations = new Map<string, Stored>();
  const runs = new Map<string, Run>();
  // The hourly limit: when each automation's hour started, and its runs in it.
  const hours = new Map<string, { startedAt: Date; runs: number }>();

  const runsOf = (automationId: string) =>
    [...runs.values()].filter((run) => run.automationId === automationId).sort(byLatest);

  function view(stored: Stored): Automation {
    const last = runsOf(stored.id).find((run) => run.kind !== 'test' && run.result !== null);
    const lastRun = last?.result
      ? { result: last.result, at: last.finishedAt ?? last.createdAt }
      : null;
    return copy({ ...stored, lastRun });
  }

  function find(workspaceId: string, id: string): Stored | null {
    const stored = automations.get(id);
    return stored && stored.workspaceId === workspaceId ? stored : null;
  }

  function prune(automationId: string): void {
    for (const run of runsOf(automationId).slice(RUNS_KEPT)) {
      if (run.finishedAt !== null) runs.delete(run.id);
    }
  }

  return {
    async list(workspaceId, filter = {}) {
      return [...automations.values()]
        .filter(
          (a) =>
            a.workspaceId === workspaceId &&
            (filter.ownerUserId === undefined || a.ownerUserId === filter.ownerUserId) &&
            (filter.enabled === undefined || a.enabled === filter.enabled) &&
            (filter.databaseId === undefined ||
              databasesUsed(a.trigger, a.actions).includes(filter.databaseId)),
        )
        .sort((a, b) => byName(a, b) || a.createdAt.getTime() - b.createdAt.getTime())
        .map(view);
    },

    async get(workspaceId, id) {
      const stored = find(workspaceId, id);
      return stored ? view(stored) : null;
    },

    async create(input, now) {
      const taken = [...automations.values()].filter((a) => a.workspaceId === input.workspaceId);
      if (taken.length >= MAX_AUTOMATIONS) return null;
      const stored: Stored = {
        ...copy(input),
        id: randomUUID(),
        pausedReason: null,
        createdAt: now,
        updatedAt: now,
      };
      automations.set(stored.id, stored);
      return view(stored);
    },

    async update(workspaceId, id, patch, now) {
      const stored = find(workspaceId, id);
      if (!stored) return null;
      const changes = Object.fromEntries(
        Object.entries(copy(patch)).filter(([, value]) => value !== undefined),
      );
      Object.assign(stored, changes, { updatedAt: now });
      return view(stored);
    },

    async remove(workspaceId, id) {
      if (!find(workspaceId, id)) return false;
      automations.delete(id);
      hours.delete(id);
      for (const run of runsOf(id)) runs.delete(run.id);
      return true;
    },

    async due(now, limit) {
      return [...automations.values()]
        .filter((a) => a.enabled && a.nextRunAt !== null && a.nextRunAt <= now)
        .sort((a, b) => (a.nextRunAt?.getTime() ?? 0) - (b.nextRunAt?.getTime() ?? 0))
        .slice(0, limit)
        .map(view);
    },

    async moveNextRun(id, from, to) {
      const stored = automations.get(id);
      if (!stored || stored.nextRunAt?.getTime() !== from.getTime()) return false;
      stored.nextRunAt = to;
      return true;
    },

    async countHourlyRun(id, now) {
      if (!automations.has(id)) return 0;
      const hour = hours.get(id);
      if (!hour || hour.startedAt.getTime() <= now.getTime() - HOUR_MS) {
        hours.set(id, { startedAt: now, runs: 1 });
        return 1;
      }
      hour.runs += 1;
      return hour.runs;
    },

    async startRun(input) {
      const automation = automations.get(input.automationId);
      if (!automation) return null;
      const same =
        input.key === null
          ? undefined
          : runsOf(input.automationId).find((run) => run.key === input.key);
      if (same) return { run: copy(same), created: false };
      const { outcome } = input;
      const run: Run = {
        id: randomUUID(),
        automationId: input.automationId,
        workspaceId: automation.workspaceId,
        kind: input.kind,
        key: input.key,
        plannedFor: input.plannedFor,
        ranAt: outcome ? null : input.now,
        finishedAt: outcome ? input.now : null,
        result: outcome?.result ?? null,
        source: copy(input.source),
        steps: copy(outcome?.steps ?? []),
        recipients: outcome?.recipients ?? 0,
        error: outcome?.error ?? null,
        startedBy: input.startedBy,
        createdAt: input.now,
      };
      runs.set(run.id, run);
      if (outcome) prune(run.automationId);
      return { run: copy(run), created: true };
    },

    async saveSteps(runId, steps, recipients) {
      const run = runs.get(runId);
      if (!run || run.result !== null) return false;
      Object.assign(run, { steps: copy(steps), recipients });
      return true;
    },

    async finishRun(runId, outcome, now) {
      const run = runs.get(runId);
      if (!run || run.result !== null) return null;
      Object.assign(run, copy(outcome), { finishedAt: now });
      prune(run.automationId);
      return copy(run);
    },

    async listRuns(workspaceId, automationId) {
      if (!find(workspaceId, automationId)) return [];
      return runsOf(automationId).map(copy);
    },
  };
}
