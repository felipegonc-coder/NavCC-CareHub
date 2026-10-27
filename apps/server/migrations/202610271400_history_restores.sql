-- Restores (Page history and Trash spec, section 3.2): the version saved just before a restore
-- remembers which version was restored and when that one was saved, for the note everyone editing
-- sees ("Avery Lin restored a version from Oct 20, 3:00 PM.") and for Updates.
ALTER TABLE history_versions
  ADD COLUMN restored_version_id uuid,
  ADD COLUMN restored_from timestamptz;
