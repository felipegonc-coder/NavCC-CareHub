-- Status page tables (Status page spec, section 4).

-- One row per minute the server was up. A missing minute counts as down. Kept for 35 days.
CREATE TABLE status_heartbeats (
  minute timestamptz PRIMARY KEY
);

-- Gaps in the heartbeats: [started_at, ended_at), recorded when heartbeats resume.
CREATE TABLE status_incidents (
  started_at timestamptz PRIMARY KEY,
  ended_at timestamptz NOT NULL,
  cause text NOT NULL CHECK (cause IN ('update', 'restart', 'unknown')),
  -- When site admins were told (a part down for more than 5 minutes), so it happens once.
  notified_at timestamptz,
  CHECK (ended_at > started_at)
);

-- The latest check of each part (server, database, files, collab, jobs, calendar).
CREATE TABLE status_checks (
  part text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('ok', 'problem', 'down', 'unknown')),
  message text,
  -- Small facts for site admins, such as free disk space or how many calendar connections fail.
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL,
  -- When the part entered its current state.
  since timestamptz NOT NULL,
  notified_at timestamptz
);

-- Backup runs as the backup service records them in backups/runs/STAMP.json.
CREATE TABLE status_backup_runs (
  stamp text PRIMARY KEY CHECK (stamp ~ '^[0-9]{8}T[0-9]{6}Z$'),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  ok boolean NOT NULL,
  db_bytes bigint CHECK (db_bytes >= 0),
  files_bytes bigint CHECK (files_bytes >= 0),
  restore_ok boolean NOT NULL,
  restore_checked_at timestamptz,
  details text,
  notified_at timestamptz
);

-- One row: this server's installation, version and current run.
CREATE TABLE status_server (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- The first time the server ran with the Status page; uptime is measured from here.
  installed_at timestamptz NOT NULL,
  version text NOT NULL,
  build_date timestamptz,
  -- When this version first started: the last update.
  version_since timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  -- Set on an orderly shutdown and cleared on start, so a gap can tell a restart from a crash.
  stopped_at timestamptz
);
