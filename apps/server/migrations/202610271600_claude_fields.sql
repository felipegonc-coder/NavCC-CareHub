-- Claude fields (docs/extras/claude.md, "Claude fields"): one row per request a Claude field sent
-- (its database, whose request, how it went), for each database's hourly cap. It never holds any
-- text from a row or from Claude.
--
-- workspace_id and database_id get their foreign keys in a later claude migration, once
-- `workspaces` and `pages` are on main.

CREATE TABLE claude_field_fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  database_id uuid NOT NULL,
  property_id text NOT NULL,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  auto boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX claude_field_fills_database_idx ON claude_field_fills (database_id, created_at);
