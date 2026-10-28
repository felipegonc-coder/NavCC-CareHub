-- Imports (Import and export spec, section 4): who imported what, where to, how it went, and
-- everything it made, for Undo import. An upload waits in ie_import_uploads until the import job
-- has read it, and is deleted once the import finishes or fails. Problems are the summary's list
-- (at most 1,000 are kept; problem_count goes on counting).
CREATE TABLE ie_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('markdown', 'html', 'word', 'google-docs', 'csv',
    'notion', 'evernote', 'confluence', 'trello', 'asana')),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  file_size bigint NOT NULL CHECK (file_size > 0),
  -- The page it goes under, or null for the top of the person's Private space (space_id).
  page_id uuid,
  space_id uuid,
  -- The Import screen read the file and uploaded its plan (plan.json and the files, zipped).
  planned boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'waiting', 'running',
    'done', 'failed', 'cancelled', 'undone')),
  job_id text,
  -- { pages, databases, rows, files } once it's done.
  counts jsonb,
  problems jsonb NOT NULL DEFAULT '[]',
  problem_count integer NOT NULL DEFAULT 0,
  -- Why it stopped, safe to show ("The import stopped: the zip is damaged. Nothing was added.").
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  undone_at timestamptz,
  CHECK (page_id IS NOT NULL OR space_id IS NOT NULL)
);

CREATE INDEX ie_imports_user_idx ON ie_imports (user_id, created_at DESC);

CREATE TABLE ie_import_uploads (
  import_id uuid PRIMARY KEY REFERENCES ie_imports (id) ON DELETE CASCADE,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- What an import made: its pages, databases and rows, each under another one (parent_id) or at
-- the destination (null). Undo import moves them to Trash.
CREATE TABLE ie_import_items (
  import_id uuid NOT NULL REFERENCES ie_imports (id) ON DELETE CASCADE,
  page_id uuid NOT NULL,
  parent_id uuid,
  kind text NOT NULL CHECK (kind IN ('page', 'database', 'row')),
  title text NOT NULL DEFAULT '',
  position integer NOT NULL,
  PRIMARY KEY (import_id, page_id)
);
