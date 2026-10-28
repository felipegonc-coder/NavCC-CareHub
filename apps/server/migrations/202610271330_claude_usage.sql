-- Claude usage log (Claude features spec; docs/extras/claude.md, "Usage log"): one row per request
-- sent to Claude, with the workspace, the person, the feature, tokens, status and time. It never
-- holds prompt or answer text. The monthly cap and each person's rate limit count these rows, and
-- Settings → Claude shows this month's use per feature.
--
-- workspace_id gets its foreign key in a later claude migration, once `workspaces` is on main.

CREATE TABLE claude_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  feature text NOT NULL
    CHECK (feature IN ('writing_help', 'assistant', 'fields', 'meeting_summary', 'learning_help')),
  status text NOT NULL CHECK (status IN ('ok', 'not_set_up', 'not_approved', 'switched_off',
    'no_permission', 'monthly_cap', 'user_rate_limit', 'too_long', 'unavailable', 'bad_output')),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX claude_usage_workspace_idx ON claude_usage (workspace_id, created_at);
CREATE INDEX claude_usage_user_idx ON claude_usage (user_id, created_at);
