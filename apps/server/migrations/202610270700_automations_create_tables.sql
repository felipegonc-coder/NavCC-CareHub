-- Automations and their runs (Automations spec, section 4). The trigger, conditions, variables,
-- actions and run steps are JSON in the shapes of @carehub/team-automations/automation, so new
-- kinds need no migration. Workspace and user IDs are stored without foreign keys.
CREATE TABLE automations_automations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  -- The limit of 50 per workspace: each automation takes a free slot from 1 to 50.
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 50),
  name text NOT NULL,
  owner_user_id uuid NOT NULL,
  enabled boolean NOT NULL,
  trigger jsonb NOT NULL,
  conditions jsonb,
  variables jsonb NOT NULL,
  actions jsonb NOT NULL,
  next_run_at timestamptz,
  paused_reason text,
  -- The hourly limit on runs: when the current hour started, and the runs in it so far.
  hour_started_at timestamptz,
  hour_runs integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, slot)
);

CREATE INDEX automations_automations_due ON automations_automations (next_run_at)
  WHERE enabled AND next_run_at IS NOT NULL;

CREATE TABLE automations_runs (
  id uuid PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES automations_automations (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('scheduled', 'test', 'manual', 'triggered')),
  key text,
  planned_for timestamptz,
  -- Null when it never ran: missed, or skipped by a limit.
  ran_at timestamptz,
  finished_at timestamptz,
  -- Null while it's running.
  result text CHECK (result IN ('sent', 'failed', 'skipped', 'missed')),
  source jsonb,
  steps jsonb NOT NULL,
  recipients integer NOT NULL DEFAULT 0,
  error text,
  started_by uuid,
  created_at timestamptz NOT NULL
);

-- One run per key: each planned time or row change runs once, even across restarts (AU-06).
CREATE UNIQUE INDEX automations_runs_key ON automations_runs (automation_id, key)
  WHERE key IS NOT NULL;

CREATE INDEX automations_runs_latest ON automations_runs (automation_id, created_at DESC);
