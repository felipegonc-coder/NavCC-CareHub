-- Wrong passwords, counted per sign-in name: after 10 within 15 minutes, signing in with that name
-- waits 15 minutes (Settings and members, Security). Names without an account are counted the same
-- way, so the answers never show which accounts exist.
CREATE TABLE sign_in_limits (
  -- SHA-256 (hex) of the sign-in name in lower case; the name itself isn't stored.
  name_hash text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  paused_until timestamptz,
  CONSTRAINT sign_in_limits_name_hash_check CHECK (name_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sign_in_limits_failures_check CHECK (failures >= 0)
);

-- For removing rows that no longer count.
CREATE INDEX sign_in_limits_window_started_at_idx ON sign_in_limits (window_started_at);

-- The counts now live in sign_in_limits.
ALTER TABLE users
  DROP CONSTRAINT users_failed_sign_ins_check,
  DROP COLUMN failed_sign_ins,
  DROP COLUMN failed_sign_ins_since,
  DROP COLUMN sign_in_paused_until;
