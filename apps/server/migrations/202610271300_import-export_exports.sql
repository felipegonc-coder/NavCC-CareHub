-- Exports: a page (with its sub-pages, rows and files, as the exporter chose) as a zip of Markdown
-- and CSV or HTML files (Import and export spec, sections 3.3 and 4). The zip is kept here until
-- its link expires, 7 days after it's ready; only its maker can download it.
--
-- workspace_id and page_id get their foreign keys in a later import-export migration, once the
-- `workspaces` and `pages` tables are on main.

CREATE TABLE ie_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('markdown', 'html')),
  -- { includeSubpages, includeFiles, databases, viewId?, origin }: ids and switches only.
  options jsonb NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'ready', 'failed', 'expired')),
  -- The background job, for exports over 50 pages or 100 MB.
  job_id text,
  progress_done integer NOT NULL DEFAULT 0 CHECK (progress_done >= 0),
  progress_total integer CHECK (progress_total >= 0),
  page_count integer CHECK (page_count >= 0),
  -- Sub-pages left out because the exporter can't open them (also counted in the zip's README).
  skipped_count integer CHECK (skipped_count >= 0),
  file_name text CHECK (char_length(file_name) BETWEEN 1 AND 200),
  file bytea,
  size_bytes bigint CHECK (size_bytes >= 0),
  -- Safe to show.
  error text CHECK (char_length(error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expires_at timestamptz,
  downloaded_at timestamptz,
  download_count integer NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  CONSTRAINT ie_exports_ready_check CHECK (
    status <> 'ready' OR (file IS NOT NULL AND expires_at IS NOT NULL AND file_name IS NOT NULL)
  )
);

-- A person's exports, newest first; also how many they have running.
CREATE INDEX ie_exports_maker_idx ON ie_exports (created_by, created_at DESC);
-- Expired files to delete.
CREATE INDEX ie_exports_expiry_idx ON ie_exports (expires_at) WHERE file IS NOT NULL;
