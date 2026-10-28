-- Notices, part 4: which kinds of notices each person gets in each workspace (Settings →
-- Notifications, Settings spec 3.3). It only adds a table.

-- No row means every kind is on. Mentions, replies, reminders and access requests can't be
-- turned off, so they have no column.
CREATE TABLE notices_settings (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  comments boolean NOT NULL DEFAULT true,
  edits boolean NOT NULL DEFAULT true,
  form_responses boolean NOT NULL DEFAULT true,
  automations boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);
