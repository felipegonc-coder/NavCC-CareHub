-- Button run log (decision 0200, db_button_runs): what each run ended with besides its outcome,
-- as the run log and the toast show it, and when it was undone (Undo works once).
ALTER TABLE db_button_runs
  ADD COLUMN failed_step integer,
  ADD COLUMN message text,
  ADD COLUMN skipped integer NOT NULL DEFAULT 0,
  ADD COLUMN messaged integer NOT NULL DEFAULT 0,
  ADD COLUMN undone_at timestamptz;
