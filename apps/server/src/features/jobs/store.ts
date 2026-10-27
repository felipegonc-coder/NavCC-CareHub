import type { Job, JobStatus, JobStore, NewJob } from './domain/types';

/** The one database call the store needs. A node-postgres Pool or Client fits. */
export interface SqlRunner {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface Row {
  id: string;
  kind: string;
  key: string | null;
  payload: string;
  status: JobStatus;
  workspace_id: string | null;
  owner_user_id: string | null;
  due_at: Date | string;
  run_at: Date | string;
  attempts: number;
  locked_by: string | null;
  locked_until: Date | string | null;
  cancel_requested: boolean;
  progress: string | null;
  result: string | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

// JSON comes back as text and is parsed here, the same with every driver.
const COLUMNS = `id::text AS id, kind, key, payload::text AS payload, status, workspace_id,
  owner_user_id, due_at, run_at, attempts, locked_by, locked_until, cancel_requested,
  progress::text AS progress, result::text AS result, error, created_at, updated_at, started_at,
  finished_at`;
const HELD = `id = $1::uuid AND locked_by = $2 AND attempts = $3::int AND status = 'running'`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const date = (value: Date | string) => (value instanceof Date ? value : new Date(value));
const dateOrNull = (value: Date | string | null) => (value === null ? null : date(value));
const iso = (value: Date) => value.toISOString();
const jsonParam = (value: unknown) => (value === null ? null : JSON.stringify(value));

function toJob(row: Row): Job {
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    payload: JSON.parse(row.payload) as Job['payload'],
    status: row.status,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    dueAt: date(row.due_at),
    runAt: date(row.run_at),
    attempts: Number(row.attempts),
    lockedBy: row.locked_by,
    lockedUntil: dateOrNull(row.locked_until),
    cancelRequested: row.cancel_requested,
    progress: row.progress === null ? null : (JSON.parse(row.progress) as Job['progress']),
    result: row.result === null ? null : (JSON.parse(row.result) as Job['result']),
    error: row.error,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    startedAt: dateOrNull(row.started_at),
    finishedAt: dateOrNull(row.finished_at),
  };
}

/** Jobs in the `jobs_queue` table (migration `*_jobs_create_queue.sql`). */
export function createPostgresJobStore(sql: SqlRunner): JobStore {
  const one = async (text: string, params: unknown[]) => {
    const { rows } = await sql.query<Row>(text, params);
    return rows[0] ? toJob(rows[0]) : null;
  };

  async function insertOnce(job: NewJob) {
    const created = await one(
      `INSERT INTO jobs_queue (id, kind, key, payload, workspace_id, owner_user_id, due_at, run_at,
         created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6, $7::timestamptz, $7::timestamptz,
         $8::timestamptz, $8::timestamptz)
       ON CONFLICT (kind, key) WHERE key IS NOT NULL AND status IN ('queued', 'running') DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        job.id,
        job.kind,
        job.key,
        JSON.stringify(job.payload),
        job.workspaceId,
        job.ownerUserId,
        iso(job.runAt),
        iso(job.now),
      ],
    );
    if (created) return { job: created, created: true };
    const existing = await one(
      `SELECT ${COLUMNS} FROM jobs_queue
       WHERE kind = $1 AND key = $2 AND status IN ('queued', 'running')`,
      [job.kind, job.key],
    );
    return existing ? { job: existing, created: false } : null;
  }

  return {
    async insert(job) {
      // The unfinished job with this key may finish between the two statements: try again.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const outcome = await insertOnce(job);
        if (outcome) return outcome;
      }
      throw new Error(`Could not add a ${job.kind} job.`);
    },

    async claim({ kind, limit, workerId, now, lockedUntil }) {
      const { rows } = await sql.query<Row>(
        `WITH next AS MATERIALIZED (
           SELECT id FROM jobs_queue
           WHERE kind = $1
             AND ((status = 'queued' AND run_at <= $2::timestamptz)
               OR (status = 'running' AND locked_until < $2::timestamptz))
           ORDER BY run_at, created_at, id
           LIMIT $3::int
           FOR UPDATE SKIP LOCKED
         )
         UPDATE jobs_queue SET status = 'running', attempts = attempts + 1, locked_by = $4,
           locked_until = $5::timestamptz, started_at = COALESCE(started_at, $2::timestamptz),
           updated_at = $2::timestamptz
         WHERE id IN (SELECT id FROM next)
         RETURNING ${COLUMNS}`,
        [kind, iso(now), limit, workerId, iso(lockedUntil)],
      );
      const ms = (value: Date) => value.getTime();
      return rows
        .map(toJob)
        .sort((a, b) => ms(a.runAt) - ms(b.runAt) || ms(a.createdAt) - ms(b.createdAt));
    },

    async setProgress(id, fence, progress, now) {
      const { rows } = await sql.query<{ id: string }>(
        `UPDATE jobs_queue SET progress = $4::jsonb, updated_at = $5::timestamptz
         WHERE ${HELD} RETURNING id::text AS id`,
        [id, fence.workerId, fence.attempt, JSON.stringify(progress), iso(now)],
      );
      return rows.length > 0;
    },

    finish: (id, fence, { status, result, error, progress, now }) =>
      one(
        `UPDATE jobs_queue SET status = $4, result = $5::jsonb, error = $6,
           progress = COALESCE($7::jsonb, progress), locked_by = NULL, locked_until = NULL,
           finished_at = $8::timestamptz, updated_at = $8::timestamptz
         WHERE ${HELD} RETURNING ${COLUMNS}`,
        [
          id,
          fence.workerId,
          fence.attempt,
          status,
          jsonParam(result),
          error,
          jsonParam(progress),
          iso(now),
        ],
      ),

    requeue: (id, fence, { runAt, error, now, countAttempt }) =>
      one(
        `UPDATE jobs_queue SET
           status = CASE WHEN cancel_requested THEN 'cancelled' ELSE 'queued' END,
           run_at = $4::timestamptz,
           attempts = CASE WHEN $5::boolean THEN attempts ELSE attempts - 1 END,
           error = $6, locked_by = NULL, locked_until = NULL,
           finished_at = CASE WHEN cancel_requested THEN $7::timestamptz END,
           updated_at = $7::timestamptz
         WHERE ${HELD} RETURNING ${COLUMNS}`,
        [id, fence.workerId, fence.attempt, iso(runAt), countAttempt, error, iso(now)],
      ),

    async get(id) {
      if (!UUID.test(id)) return null;
      return one(`SELECT ${COLUMNS} FROM jobs_queue WHERE id = $1::uuid`, [id]);
    },

    async cancel(id, now) {
      if (!UUID.test(id)) return null;
      const changed = await one(
        `UPDATE jobs_queue SET
           status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
           cancel_requested = cancel_requested OR status = 'running',
           finished_at = CASE WHEN status = 'queued' THEN $2::timestamptz ELSE finished_at END,
           updated_at = $2::timestamptz
         WHERE id = $1::uuid AND status IN ('queued', 'running')
         RETURNING ${COLUMNS}`,
        [id, iso(now)],
      );
      return changed ?? one(`SELECT ${COLUMNS} FROM jobs_queue WHERE id = $1::uuid`, [id]);
    },

    async listCancelRequested(ids) {
      const valid = ids.filter((id) => UUID.test(id));
      if (valid.length === 0) return [];
      const { rows } = await sql.query<{ id: string }>(
        `SELECT id::text AS id FROM jobs_queue
         WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))
           AND status = 'running' AND cancel_requested`,
        [JSON.stringify(valid)],
      );
      return rows.map((row) => row.id);
    },

    async deleteFinishedBefore(cutoff, limit) {
      const { rows } = await sql.query<{ count: number }>(
        `WITH doomed AS MATERIALIZED (
           SELECT id FROM jobs_queue
           WHERE status IN ('succeeded', 'failed', 'cancelled') AND finished_at < $1::timestamptz
           ORDER BY finished_at
           LIMIT $2::int
           FOR UPDATE SKIP LOCKED
         ), deleted AS (
           DELETE FROM jobs_queue WHERE id IN (SELECT id FROM doomed) RETURNING 1
         )
         SELECT count(*)::int AS count FROM deleted`,
        [iso(cutoff), limit],
      );
      return Number(rows[0]?.count ?? 0);
    },
  };
}
