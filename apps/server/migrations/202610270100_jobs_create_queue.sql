-- Background jobs: a queue claimed with FOR UPDATE SKIP LOCKED. Periodic tasks are rows of kind
-- 'jobs.periodic' keyed by task name. Finished rows are deleted after 7 days.
CREATE TABLE jobs_queue (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  key text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  workspace_id text,
  owner_user_id text,
  due_at timestamptz NOT NULL,
  run_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  locked_by text,
  locked_until timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  progress jsonb,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz
);

-- A key dedupes among unfinished jobs of the same kind.
CREATE UNIQUE INDEX jobs_queue_kind_key_unfinished ON jobs_queue (kind, key)
  WHERE key IS NOT NULL AND status IN ('queued', 'running');

-- Claiming: due queued jobs, and running jobs whose lock ran out.
CREATE INDEX jobs_queue_due ON jobs_queue (kind, run_at) WHERE status = 'queued';
CREATE INDEX jobs_queue_running ON jobs_queue (kind, locked_until) WHERE status = 'running';

-- Clean-up.
CREATE INDEX jobs_queue_finished ON jobs_queue (finished_at)
  WHERE status IN ('succeeded', 'failed', 'cancelled');
