-- CSV and Excel imports (decision 0200): the uploaded file until the import job ends, and what the
-- job needs for its summary, its problem list and Undo. db_imports itself comes with
-- 202610270600_databases_tables.sql.

-- The file and the dialog's choices (kind, sheet, separator, first row is headers, column plan).
-- Deleted when the job ends, whether it worked or not.
CREATE TABLE db_import_files (
  import_id uuid PRIMARY KEY REFERENCES db_imports (id) ON DELETE CASCADE,
  bytes bytea NOT NULL,
  request jsonb NOT NULL
);

ALTER TABLE db_imports
  ADD COLUMN file_name text NOT NULL DEFAULT '',
  -- Every value that couldn't be read; `problems` lists the first 10,000.
  ADD COLUMN problem_count integer NOT NULL DEFAULT 0,
  -- The properties and options the import made: { propertyIds, options: { propertyId: optionIds } }.
  ADD COLUMN created jsonb NOT NULL DEFAULT '{}',
  -- Why it failed, as the job shows it.
  ADD COLUMN error text,
  ADD COLUMN finished_at timestamptz,
  ADD CONSTRAINT db_imports_status_check
    CHECK (status IN ('queued', 'done', 'failed', 'undone'));
