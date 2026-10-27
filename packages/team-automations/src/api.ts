/**
 * What `/api/automations` answers, for the web app: automations and runs with their times as ISO
 * strings. Admins only (AU-D1).
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
} from './automation';

export interface AutomationView {
  id: string;
  name: string;
  ownerUserId: string;
  enabled: boolean;
  trigger: Trigger;
  /** A Databases filter the row must also match; database triggers only. */
  conditions: Json | null;
  variables: Variable[];
  actions: Action[];
  /** Scheduled automations that are on; null for the rest. */
  nextRunAt: string | null;
  /** Why the server switched it off, such as a recipient who can't open a page anymore. */
  pausedReason: string | null;
  /** The latest finished run that wasn't a test. */
  lastRun: { result: RunResult; at: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunView {
  id: string;
  kind: RunKind;
  plannedFor: string | null;
  /** Null when it never ran: missed, or skipped by a limit. */
  ranAt: string | null;
  finishedAt: string | null;
  /** Null while it's running. */
  result: RunResult | null;
  /** The row or form response that fired it. */
  source: RunSource | null;
  steps: RunStep[];
  recipients: number;
  error: string | null;
  /** Who pressed Try it now or Send to everyone now. */
  startedBy: string | null;
  createdAt: string;
}

/** `GET /api/automations` (filters: `databaseId`, `ownerUserId`, `enabled`). */
export interface AutomationListResponse {
  automations: AutomationView[];
}

/** `POST /api/automations`, and `GET` or `PATCH /api/automations/:id`. */
export interface AutomationResponse {
  automation: AutomationView;
}

/** `GET /api/automations/:id/runs`: the latest 100, newest first. */
export interface RunListResponse {
  runs: RunView[];
}

/**
 * `POST /api/automations/:id/try` (body: `TryNowInput`), 202: the run's job. Watch it (useJob)
 * to keep the button busy until the run ends.
 */
export interface TryNowResponse {
  jobId: string;
}
