-- CSV exports (decision 0200; spec 3.8): the finished file of a `databases.csv-export` job, for the
-- person who asked only. Downloads are refused after 24 hours, and a periodic task deletes the
-- older ones.
CREATE TABLE db_exports (
  id uuid PRIMARY KEY,
  database_id uuid NOT NULL REFERENCES db_databases (page_id) ON DELETE CASCADE,
  "by" uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  file_name text NOT NULL,
  csv text NOT NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX db_exports_created_idx ON db_exports (created_at);
