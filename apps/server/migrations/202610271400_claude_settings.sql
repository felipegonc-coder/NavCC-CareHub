-- Claude's workspace settings (docs/extras/claude.md, "Settings → Claude"): claude.workspaceApproved,
-- the switches claude.<feature> and claude.chatRetentionDays. A missing row means off, or for the
-- retention, kept until deleted (CL-D3).
--
-- stand-in: getWorkspaceSetting / setWorkspaceSetting (decision 0007). Once they exist, a later
-- migration copies these rows there and drops this table.

CREATE TABLE claude_settings (
  workspace_id uuid NOT NULL,
  key text NOT NULL CHECK (key ~ '^claude\.[A-Za-z_]{1,40}$'),
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);
