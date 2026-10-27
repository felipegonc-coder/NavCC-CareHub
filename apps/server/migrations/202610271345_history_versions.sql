-- Page versions (Page history and Trash spec, sections 3.1 and 4). Each version is a full copy of
-- the page as it was: title, icon, cover, page style and content (ProseMirror JSON). The spec
-- allows keeping only the changes, with a full copy every 20 versions; full copies come first
-- (Postgres compresses large values), and reading a version doesn't depend on how it's stored.
CREATE TABLE history_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  -- Saved after edits, or right before something replaced the content.
  kind text NOT NULL CHECK (kind IN ('automatic', 'before_restore', 'before_import',
    'before_template', 'before_replace', 'before_accept_all', 'before_automation')),
  -- Named versions are kept forever, up to 100 per page.
  name text CHECK (char_length(name) BETWEEN 1 AND 100),
  named_by uuid,
  named_at timestamptz,
  -- Everyone who edited in the stretch this version closes, first editor first.
  editor_ids uuid[] NOT NULL DEFAULT '{}',
  -- Who made a "before" version happen (a restore, an import); null for automatic ones.
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL DEFAULT '',
  icon jsonb,
  cover jsonb,
  style jsonb NOT NULL DEFAULT '{}',
  content jsonb NOT NULL,
  -- sha-256 of the copy: an automatic version that matches the one before it isn't kept.
  digest text NOT NULL,
  -- Bytes of the copy as JSON, for the storage numbers in Data settings.
  size integer NOT NULL
);

CREATE INDEX history_versions_page_idx ON history_versions (page_id, created_at DESC);
-- The nightly clean-up deletes unnamed versions by age.
CREATE INDEX history_versions_unnamed_idx ON history_versions (workspace_id, created_at)
  WHERE name IS NULL;

-- Edits that aren't in a version yet, one row per page. A version is saved 2 minutes after the
-- last edit, or 9 minutes after the first one in long sessions, and names everyone in editor_ids.
CREATE TABLE history_edits (
  page_id uuid PRIMARY KEY,
  first_at timestamptz,
  last_at timestamptz,
  editor_ids uuid[] NOT NULL DEFAULT '{}',
  -- Saves up to this time are in a version already, or were the history's own writes (restores).
  settled_at timestamptz
);

CREATE INDEX history_edits_open_idx ON history_edits (last_at) WHERE first_at IS NOT NULL;
