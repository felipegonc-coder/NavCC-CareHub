/**
 * Automations and their runs as the server keeps them, and the store interface (Automations spec,
 * sections 3 and 4). The parts inside them (triggers, actions, run steps) come from
 * `@carehub/team-automations/automation`.
 */
import type {
  Action,
  Json,
  RunKind,
  RunResult,
  RunSource,
  RunStep,
  Trigger,
  Variable,
} from '@carehub/team-automations/automation';

export interface Automation {
  id: string;
  workspaceId: string;
  name: string;
  ownerUserId: string;
  enabled: boolean;
  trigger: Trigger;
  /** A Databases filter the row must also match ("and Team is Phoenix"); database triggers only. */
  conditions: Json | null;
  variables: Variable[];
  actions: Action[];
  /** Scheduled automations only. */
  nextRunAt: Date | null;
  /** Why the server switched it off ("Sam Ortiz can't open QA reviews anymore"). */
  pausedReason: string | null;
  /** The latest finished run that wasn't a test. */
  lastRun: { result: RunResult; at: Date } | null;
  createdAt: Date;
  updatedAt: Date;
}

type Settings =
  'name' | 'ownerUserId' | 'enabled' | 'trigger' | 'conditions' | 'variables' | 'actions';

export type NewAutomation = Pick<Automation, Settings | 'workspaceId' | 'nextRunAt'>;

/** Only the fields that are there change. */
export type AutomationPatch = Partial<Pick<Automation, Settings | 'nextRunAt' | 'pausedReason'>>;

export interface AutomationFilter {
  /** The trigger or an action uses this database. */
  databaseId?: string;
  ownerUserId?: string;
  enabled?: boolean;
}

export interface Run {
  id: string;
  automationId: string;
  workspaceId: string;
  kind: RunKind;
  /** One run per key and automation ("scheduled:<planned time>", "row:<row id>"); null never dedupes. */
  key: string | null;
  plannedFor: Date | null;
  /** When it started; null when it never ran (missed, or skipped by a limit). */
  ranAt: Date | null;
  finishedAt: Date | null;
  /** Null while it's running. */
  result: RunResult | null;
  source: RunSource | null;
  steps: RunStep[];
  recipients: number;
  error: string | null;
  /** Who pressed Try it now. */
  startedBy: string | null;
  /** When it was logged: the run history's order. */
  createdAt: Date;
}

export interface RunOutcome {
  result: RunResult;
  steps: RunStep[];
  recipients: number;
  error: string | null;
}

export interface NewRun {
  automationId: string;
  kind: RunKind;
  key: string | null;
  plannedFor: Date | null;
  source: RunSource | null;
  startedBy: string | null;
  now: Date;
  /** Logs a run that never ran, such as a missed one, as finished at once. */
  outcome?: RunOutcome;
}

/** Where automations and their runs are kept: store.ts (Postgres) or memoryStore.ts (tests). */
export interface AutomationStore {
  /** Sorted by name. */
  list(workspaceId: string, filter?: AutomationFilter): Promise<Automation[]>;
  get(workspaceId: string, id: string): Promise<Automation | null>;
  /** Null when the workspace already has MAX_AUTOMATIONS. */
  create(input: NewAutomation, now: Date): Promise<Automation | null>;
  update(
    workspaceId: string,
    id: string,
    patch: AutomationPatch,
    now: Date,
  ): Promise<Automation | null>;
  /** Deletes it and its runs; false when it isn't there. */
  remove(workspaceId: string, id: string): Promise<boolean>;
  /** Switched-on automations in any workspace whose next run is at or before `now`, soonest first. */
  due(now: Date, limit: number): Promise<Automation[]>;
  /** Moves the next run from `from` to `to`; false when another server has already moved it. */
  moveNextRun(id: string, from: Date, to: Date | null): Promise<boolean>;
  /**
   * Counts a run against the hourly limit and returns the runs so far this hour, this one
   * included. An hour starts with its first run.
   */
  countHourlyRun(id: string, now: Date): Promise<number>;
  /** Adds a run, or returns the one with the same key. Null when the automation is gone. */
  startRun(input: NewRun): Promise<{ run: Run; created: boolean } | null>;
  /** Saves the steps a running run has done so far, so a retry carries on after them. */
  saveSteps(runId: string, steps: RunStep[], recipients: number): Promise<boolean>;
  /** Null when the run is gone or already finished. Keeps the latest RUNS_KEPT runs. */
  finishRun(runId: string, outcome: RunOutcome, now: Date): Promise<Run | null>;
  /** The kept runs, newest first. */
  listRuns(workspaceId: string, automationId: string): Promise<Run[]>;
}
