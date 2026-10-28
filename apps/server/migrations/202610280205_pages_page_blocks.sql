-- Page blocks (decision 0012, point 19): a sub-page lives in its parent's content as a page block,
-- an inline database as a database block (Pages and blocks 3.3 and 3.4).
ALTER TABLE pages
  -- The page whose content held this page's block when that content was last read.
  ADD COLUMN block_parent_id uuid REFERENCES pages (id) ON DELETE SET NULL,
  -- In Trash because its block was deleted (the entry's deleted_at): the block coming back
  -- (Undo) restores it.
  ADD COLUMN block_trashed_at timestamptz;

CREATE INDEX pages_block_parent_idx ON pages (block_parent_id) WHERE block_parent_id IS NOT NULL;
