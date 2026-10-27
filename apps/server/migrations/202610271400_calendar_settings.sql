-- Calendar: each person's Calendar settings (Calendar spec, section 2). Only the settings they
-- changed are stored; the rest use the defaults.

CREATE TABLE cal_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Changed settings by name, such as { "hideWeekends": true }.
  settings jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
