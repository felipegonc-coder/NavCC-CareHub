-- Updates (Page history and Trash spec, sections 3.3 and 4): what happened on a page, for its
-- Updates panel. Details hold small facts (old and new title, the pages a move went between, a
-- property's old and new value as text), never page content. Entries are kept as long as
-- automatic versions: the nightly clean-up deletes them after the same period.
CREATE TABLE history_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('created', 'edited', 'renamed', 'moved', 'shared', 'locked',
    'unlocked', 'commented', 'suggestion_accepted', 'property_changed', 'restored', 'archived',
    'unarchived', 'trashed', 'untrashed')),
  -- Who did it; null for automations.
  actor_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  -- The version an edit is in, for Show changes.
  version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX history_updates_page_idx ON history_updates (page_id, created_at DESC, id DESC);
CREATE INDEX history_updates_age_idx ON history_updates (workspace_id, created_at);
