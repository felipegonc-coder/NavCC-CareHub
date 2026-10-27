-- Trash (Page history and Trash 3.4; decision 0012, point 17): each entry's pages by the page that
-- took them along, for counting, restoring and the nightly cleanup.
CREATE INDEX pages_trash_idx ON pages (trash_root_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX spaces_trash_idx ON spaces (deleted_at) WHERE deleted_at IS NOT NULL;
