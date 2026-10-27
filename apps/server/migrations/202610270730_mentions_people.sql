-- Mentions of people (Comments and mentions spec, sections 3.3 and 4): in page text (a block) or
-- in a comment. Each one sends its person at most one notice, through the `mentions.send` job.
--
-- workspace_id and page_id get their foreign keys in a later mentions migration, once the
-- `workspaces` and `pages` tables are on main (page_id with ON DELETE CASCADE).

CREATE TABLE mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  -- Page text: the block the mention is in. A comment: the comment.
  block_id text CHECK (block_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  comment_id uuid REFERENCES comments (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  mentioned_by uuid NOT NULL REFERENCES users (id),
  -- Page text only: the sentence it's in, for the notice. A comment's notice has its text.
  snippet text NOT NULL DEFAULT '' CHECK (char_length(snippet) <= 300),
  -- waiting (until send_at), sent, quiet ("Mention without notifying", or yourself), cancelled
  -- (deleted from the text in time) or no_access (the person couldn't open the page).
  status text NOT NULL CHECK (status IN ('waiting', 'sent', 'quiet', 'cancelled', 'no_access')),
  send_at timestamptz,
  sent_at timestamptz,
  notice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentions_place_check CHECK ((block_id IS NULL) <> (comment_id IS NULL)),
  CONSTRAINT mentions_sent_check CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  -- One notice per comment per person, even when an edit mentions them again.
  CONSTRAINT mentions_comment_person_key UNIQUE (comment_id, user_id)
);

CREATE INDEX mentions_page_idx ON mentions (page_id, block_id, user_id, created_at DESC);
CREATE INDEX mentions_person_idx ON mentions (user_id, created_at DESC);
