-- Comments: threads on a page, on its text, on a block or on a row's property, and their comments
-- (Comments and mentions spec, sections 3.1 and 4; decision 0007, section 4.3). Reactions,
-- suggestions, mentions and following come in later comments migrations.
--
-- workspace_id and page_id get their foreign keys in a later comments migration, once the
-- `workspaces` and `pages` tables are on main (page_id with ON DELETE CASCADE).

CREATE TABLE comment_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  -- A text thread's text carries a comment mark with the thread's ID in the page, so it follows
  -- edits; `quote` keeps the text for when it's deleted.
  spot text NOT NULL CHECK (spot IN ('page', 'text', 'block', 'property')),
  block_id text CHECK (block_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  property_id text CHECK (property_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  quote text CHECK (char_length(quote) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_comment_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users (id),
  CONSTRAINT comment_threads_place_check CHECK (
    (spot = 'page' AND block_id IS NULL AND property_id IS NULL AND quote IS NULL)
    OR (spot = 'text' AND block_id IS NOT NULL AND property_id IS NULL AND quote IS NOT NULL)
    OR (spot = 'block' AND block_id IS NOT NULL AND property_id IS NULL AND quote IS NULL)
    OR (spot = 'property' AND property_id IS NOT NULL AND block_id IS NULL AND quote IS NULL)
  ),
  CONSTRAINT comment_threads_resolved_check CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);

-- A page's threads, the newest activity first; also the limit of 1,000 per page.
CREATE INDEX comment_threads_page_idx ON comment_threads (page_id, last_comment_at DESC);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES comment_threads (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users (id),
  -- As written, with people mentioned as `<@userId>`. Emptied when the comment is deleted.
  body text NOT NULL CHECK (char_length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- "edited"
  edited_at timestamptz,
  -- "This comment was deleted": only a thread's first comment stays, while it has replies.
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users (id),
  CONSTRAINT comments_deleted_check CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND body <> '')
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND body = '')
  )
);

-- A thread's comments in order; also the limit of 500 per thread.
CREATE INDEX comments_thread_idx ON comments (thread_id, created_at, id);
