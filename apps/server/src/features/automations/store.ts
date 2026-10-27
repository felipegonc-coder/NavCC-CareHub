import { randomUUID } from 'node:crypto';
import {
  databasesUsed,
  MAX_AUTOMATIONS,
  RUNS_KEPT,
  type Json,
} from '@carehub/team-automations/automation';
import type { Automation, AutomationStore, Run } from './domain/types';

/** The one database call the store needs: a node-postgres Pool or Client, or `sqlRunnerFor(app.db)`. */
export interface SqlRunner {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

type Stamp = Date | string;

interface AutomationRow {
  id: string;
  workspace_id: string;
  name: string;
  owner_user_id: string;
  enabled: boolean;
  trigger: string;
  conditions: string | null;
  variables: string;
  actions: string;
  next_run_at: Stamp | null;
  paused_reason: string | null;
  created_at: Stamp;
  updated_at: Stamp;
  last_result: Run['result'];
  last_at: Stamp | null;
}

interface RunRow {
  id: string;
  automation_id: string;
  workspace_id: string;
  kind: Run['kind'];
  key: string | null;
  planned_for: Stamp | null;
  ran_at: Stamp | null;
  finished_at: Stamp | null;
  result: Run['result'];
  source: string | null;
  steps: string;
  recipients: number;
  error: string | null;
  started_by: string | null;
  created_at: Stamp;
}

// JSON comes back as text and is parsed here, the same with every driver.
const AUTOMATION = `a.id::text AS id, a.workspace_id::text AS workspace_id, a.name,
  a.owner_user_id::text AS owner_user_id, a.enabled, a.trigger::text AS trigger,
  a.conditions::text AS conditions, a.variables::text AS variables, a.actions::text AS actions,
  a.next_run_at, a.paused_reason, a.created_at, a.updated_at, latest.result AS last_result,
  latest.finished_at AS last_at`;
// The latest finished run that wasn't a test.
const LAST_RUN = `LEFT JOIN LATERAL (
  SELECT r.result, r.finished_at FROM automations_runs r
  WHERE r.automation_id = a.id AND r.kind <> 'test' AND r.result IS NOT NULL
  ORDER BY r.created_at DESC, r.id DESC LIMIT 1) latest ON true`;
const BY_NAME = `ORDER BY lower(a.name) COLLATE "C", a.created_at, a.id`;
const RUN = `r.id::text AS id, r.automation_id::text AS automation_id,
  r.workspace_id::text AS workspace_id, r.kind, r.key, r.planned_for, r.ran_at, r.finished_at,
  r.result, r.source::text AS source, r.steps::text AS steps, r.recipients, r.error,
  r.started_by::text AS started_by, r.created_at`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (...values: string[]) => values.every((value) => UUID.test(value));
const date = (value: Stamp) => (value instanceof Date ? value : new Date(value));
const dateOrNull = (value: Stamp | null) => (value === null ? null : date(value));
const iso = (value: Date | null) => (value === null ? null : value.toISOString());
const parse = <T>(text: string) => JSON.parse(text) as T;
const json = (value: Json | object | null) => (value === null ? null : JSON.stringify(value));

function toAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    enabled: row.enabled,
    trigger: parse(row.trigger),
    conditions: row.conditions === null ? null : parse(row.conditions),
    variables: parse(row.variables),
    actions: parse(row.actions),
    nextRunAt: dateOrNull(row.next_run_at),
    pausedReason: row.paused_reason,
    lastRun:
      row.last_result && row.last_at ? { result: row.last_result, at: date(row.last_at) } : null,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    automationId: row.automation_id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    key: row.key,
    plannedFor: dateOrNull(row.planned_for),
    ranAt: dateOrNull(row.ran_at),
    finishedAt: dateOrNull(row.finished_at),
    result: row.result,
    source: row.source === null ? null : parse(row.source),
    steps: parse(row.steps),
    recipients: Number(row.recipients),
    error: row.error,
    startedBy: row.started_by,
    createdAt: date(row.created_at),
  };
}

/** Automations in Postgres: the tables from migrations/202610270700_automations_create_tables.sql. */
export function createPostgresAutomationStore(db: SqlRunner): AutomationStore {
  async function automations(where: string, params: unknown[], order = BY_NAME) {
    const { rows } = await db.query<AutomationRow>(
      `SELECT ${AUTOMATION} FROM automations_automations a ${LAST_RUN} WHERE ${where} ${order}`,
      params,
    );
    return rows.map(toAutomation);
  }

  // Keeps the latest RUNS_KEPT runs; runs that haven't finished stay.
  async function prune(automationId: string) {
    await db.query(
      `DELETE FROM automations_runs WHERE automation_id = $1::uuid AND finished_at IS NOT NULL
         AND id NOT IN (SELECT id FROM automations_runs WHERE automation_id = $1::uuid
           ORDER BY created_at DESC, id DESC LIMIT ${RUNS_KEPT})`,
      [automationId],
    );
  }

  return {
    async list(workspaceId, filter = {}) {
      if (!isUuid(workspaceId)) return [];
      const where = ['a.workspace_id = $1::uuid'];
      const params: unknown[] = [workspaceId];
      if (filter.ownerUserId !== undefined) {
        if (!isUuid(filter.ownerUserId)) return [];
        params.push(filter.ownerUserId);
        where.push(`a.owner_user_id = $${params.length}::uuid`);
      }
      if (filter.enabled !== undefined) {
        params.push(filter.enabled);
        where.push(`a.enabled = $${params.length}::boolean`);
      }
      const found = await automations(where.join(' AND '), params);
      // At most 50 per workspace, so the database filter works on the JSON here.
      const { databaseId } = filter;
      return databaseId === undefined
        ? found
        : found.filter((a) => databasesUsed(a.trigger, a.actions).includes(databaseId));
    },

    async get(workspaceId, id) {
      if (!isUuid(workspaceId, id)) return null;
      const [found] = await automations('a.workspace_id = $1::uuid AND a.id = $2::uuid', [
        workspaceId,
        id,
      ]);
      return found ?? null;
    },

    async create(input, now) {
      // Each automation takes a free slot from 1 to 50, so the limit holds with any number of
      // servers. Two creates can pick the same slot; the second then tries the next one.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const { rows } = await db.query<AutomationRow>(
          `WITH a AS (
             INSERT INTO automations_automations (id, workspace_id, slot, name, owner_user_id,
               enabled, trigger, conditions, variables, actions, next_run_at, created_at,
               updated_at)
             SELECT $1::uuid, $2::uuid, s, $3::text, $4::uuid, $5::boolean, $6::jsonb, $7::jsonb,
               $8::jsonb, $9::jsonb, $10::timestamptz, $11::timestamptz, $11::timestamptz
             FROM generate_series(1, ${MAX_AUTOMATIONS}) AS s
             WHERE NOT EXISTS (SELECT 1 FROM automations_automations t
               WHERE t.workspace_id = $2::uuid AND t.slot = s)
             ORDER BY s LIMIT 1
             ON CONFLICT DO NOTHING
             RETURNING *)
           SELECT ${AUTOMATION} FROM a ${LAST_RUN}`,
          [
            randomUUID(),
            input.workspaceId,
            input.name,
            input.ownerUserId,
            input.enabled,
            json(input.trigger),
            json(input.conditions),
            json(input.variables),
            json(input.actions),
            iso(input.nextRunAt),
            iso(now),
          ],
        );
        if (rows[0]) return toAutomation(rows[0]);
        const { rows: counted } = await db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM automations_automations WHERE workspace_id = $1::uuid',
          [input.workspaceId],
        );
        if (Number(counted[0]?.n ?? 0) >= MAX_AUTOMATIONS) return null;
      }
      throw new Error("Couldn't add the automation: too many at the same moment.");
    },

    async update(workspaceId, id, patch, now) {
      if (!isUuid(workspaceId, id)) return null;
      const params: unknown[] = [workspaceId, id, iso(now)];
      const sets = ['updated_at = $3::timestamptz'];
      const set = (column: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`${column} = $${params.length}${cast}`);
      };
      if (patch.name !== undefined) set('name', patch.name, '::text');
      if (patch.ownerUserId !== undefined) set('owner_user_id', patch.ownerUserId, '::uuid');
      if (patch.enabled !== undefined) set('enabled', patch.enabled, '::boolean');
      if (patch.trigger !== undefined) set('trigger', json(patch.trigger), '::jsonb');
      if (patch.conditions !== undefined) set('conditions', json(patch.conditions), '::jsonb');
      if (patch.variables !== undefined) set('variables', json(patch.variables), '::jsonb');
      if (patch.actions !== undefined) set('actions', json(patch.actions), '::jsonb');
      if (patch.nextRunAt !== undefined) set('next_run_at', iso(patch.nextRunAt), '::timestamptz');
      if (patch.pausedReason !== undefined) set('paused_reason', patch.pausedReason, '::text');
      const { rows } = await db.query<AutomationRow>(
        `WITH a AS (
           UPDATE automations_automations SET ${sets.join(', ')}
           WHERE workspace_id = $1::uuid AND id = $2::uuid RETURNING *)
         SELECT ${AUTOMATION} FROM a ${LAST_RUN}`,
        params,
      );
      return rows[0] ? toAutomation(rows[0]) : null;
    },

    async remove(workspaceId, id) {
      if (!isUuid(workspaceId, id)) return false;
      const { rows } = await db.query(
        `DELETE FROM automations_automations WHERE workspace_id = $1::uuid AND id = $2::uuid
         RETURNING id`,
        [workspaceId, id],
      );
      return rows.length > 0;
    },

    async due(now, limit) {
      return automations(
        'a.enabled AND a.next_run_at <= $1::timestamptz',
        [iso(now), limit],
        'ORDER BY a.next_run_at, a.id LIMIT $2::int',
      );
    },

    async moveNextRun(id, from, to) {
      if (!isUuid(id)) return false;
      const { rows } = await db.query(
        `UPDATE automations_automations SET next_run_at = $3::timestamptz
         WHERE id = $1::uuid AND next_run_at = $2::timestamptz RETURNING id`,
        [id, iso(from), iso(to)],
      );
      return rows.length > 0;
    },

    async countHourlyRun(id, now) {
      if (!isUuid(id)) return 0;
      const { rows } = await db.query<{ hour_runs: number }>(
        `UPDATE automations_automations SET
           hour_runs = CASE WHEN hour_started_at > $2::timestamptz - interval '1 hour'
             THEN hour_runs + 1 ELSE 1 END,
           hour_started_at = CASE WHEN hour_started_at > $2::timestamptz - interval '1 hour'
             THEN hour_started_at ELSE $2::timestamptz END
         WHERE id = $1::uuid RETURNING hour_runs`,
        [id, iso(now)],
      );
      return Number(rows[0]?.hour_runs ?? 0);
    },

    async startRun(input) {
      if (!isUuid(input.automationId)) return null;
      const { outcome } = input;
      const { rows } = await db.query<RunRow>(
        `INSERT INTO automations_runs AS r (id, automation_id, workspace_id, kind, key,
           planned_for, ran_at, finished_at, result, source, steps, recipients, error,
           started_by, created_at)
         SELECT $1::uuid, a.id, a.workspace_id, $3::text, $4::text, $5::timestamptz, $6::timestamptz,
           $7::timestamptz, $8::text, $9::jsonb, $10::jsonb, $11::int, $12::text, $13::uuid,
           $14::timestamptz
         FROM automations_automations a WHERE a.id = $2::uuid
         ON CONFLICT (automation_id, key) WHERE key IS NOT NULL DO NOTHING
         RETURNING ${RUN}`,
        [
          randomUUID(),
          input.automationId,
          input.kind,
          input.key,
          iso(input.plannedFor),
          outcome ? null : iso(input.now),
          outcome ? iso(input.now) : null,
          outcome?.result ?? null,
          json(input.source),
          json(outcome?.steps ?? []),
          outcome?.recipients ?? 0,
          outcome?.error ?? null,
          input.startedBy,
          iso(input.now),
        ],
      );
      if (rows[0]) {
        if (outcome) await prune(input.automationId);
        return { run: toRun(rows[0]), created: true };
      }
      if (input.key === null) return null;
      const { rows: same } = await db.query<RunRow>(
        `SELECT ${RUN} FROM automations_runs r WHERE r.automation_id = $1::uuid AND r.key = $2::text`,
        [input.automationId, input.key],
      );
      return same[0] ? { run: toRun(same[0]), created: false } : null;
    },

    async saveSteps(runId, steps, recipients) {
      if (!isUuid(runId)) return false;
      const { rows } = await db.query<{ id: string }>(
        `UPDATE automations_runs SET steps = $2::jsonb, recipients = $3::int
         WHERE id = $1::uuid AND result IS NULL RETURNING id`,
        [runId, json(steps), recipients],
      );
      return rows.length > 0;
    },

    async finishRun(runId, outcome, now) {
      if (!isUuid(runId)) return null;
      const { rows } = await db.query<RunRow>(
        `UPDATE automations_runs AS r SET result = $2::text, steps = $3::jsonb,
           recipients = $4::int, error = $5::text, finished_at = $6::timestamptz
         WHERE r.id = $1::uuid AND r.result IS NULL RETURNING ${RUN}`,
        [runId, outcome.result, json(outcome.steps), outcome.recipients, outcome.error, iso(now)],
      );
      if (!rows[0]) return null;
      await prune(rows[0].automation_id);
      return toRun(rows[0]);
    },

    async listRuns(workspaceId, automationId) {
      if (!isUuid(workspaceId, automationId)) return [];
      const { rows } = await db.query<RunRow>(
        `SELECT ${RUN} FROM automations_runs r
         WHERE r.workspace_id = $1::uuid AND r.automation_id = $2::uuid
         ORDER BY r.created_at DESC, r.id DESC`,
        [workspaceId, automationId],
      );
      return rows.map(toRun);
    },
  };
}
