-- Analytics tables (Analytics spec, section 4). Nothing is stored for private spaces, Messages,
-- Calendar, Meetings or Claude (AN-03). Activity older than a year is deleted every night (AN-07).

-- Views, edits, creates, deletes (to the Trash) and restores of pages, databases and rows, after
-- counting once (AN-01, AN-02). Deleted pages keep their numbers, so page_id has no foreign key;
-- workspace_id gets one when workspaces arrive.
CREATE TABLE analytics_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  -- Null once the person's account is deleted: their activity still counts in the totals.
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  page_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('view', 'edit', 'create', 'delete', 'restore')),
  at timestamptz NOT NULL
);

CREATE INDEX analytics_activity_workspace_at_idx ON analytics_activity (workspace_id, at);
CREATE INDEX analytics_activity_page_at_idx ON analytics_activity (page_id, at);
CREATE INDEX analytics_activity_user_at_idx ON analytics_activity (user_id, at);
CREATE INDEX analytics_activity_at_idx ON analytics_activity (at);

-- When each person's view and edit of each page last counted. Repeats within 30 minutes (views)
-- or 10 minutes (edits) of it count once. Rows older than a day are deleted every night.
CREATE TABLE analytics_last_counted (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  page_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('view', 'edit')),
  at timestamptz NOT NULL,
  PRIMARY KEY (user_id, page_id, kind)
);

CREATE INDEX analytics_last_counted_at_idx ON analytics_last_counted (at);

-- The title, space and state of each page with activity, kept here so pages deleted for good
-- still show their numbers, marked "(deleted)".
CREATE TABLE analytics_pages (
  page_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  space_id uuid,
  state text NOT NULL DEFAULT 'live' CHECK (state IN ('live', 'trash', 'deleted')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_pages_space_idx ON analytics_pages (space_id);
