-- Calendar: each person's layers, with their colour, on or off switch and place in the list.
-- A built-in layer ('my-events', 'meetings') gets its row the first time its person changes it;
-- until then it shows with its defaults. Database layers get a row when they're added.

CREATE TABLE cal_layers (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id text NOT NULL,
  kind text NOT NULL,
  -- A design-kit colour name, such as 'blue'.
  color text NOT NULL,
  is_on boolean NOT NULL DEFAULT true,
  position integer NOT NULL,
  -- Database layers: the database, its date property and, optionally, the view whose filters apply.
  database_id text,
  property_id text,
  view_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, id),
  CONSTRAINT cal_layers_kind_check
    CHECK (kind IN ('my-events', 'meetings', 'learning', 'database')),
  CONSTRAINT cal_layers_database_check
    CHECK ((kind = 'database') = (database_id IS NOT NULL AND property_id IS NOT NULL))
);

-- Events belong to a workspace (added here: 202610271200 landed before the workspaces table).
ALTER TABLE cal_events
  ADD CONSTRAINT cal_events_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE;

-- The video link gets a length check like the title, location and description (the API takes
-- up to 2,000 characters).
ALTER TABLE cal_events
  ADD CONSTRAINT cal_events_video_url_length CHECK (char_length(video_url) <= 2000);
