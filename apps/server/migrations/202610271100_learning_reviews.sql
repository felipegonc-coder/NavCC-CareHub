-- Learning reviews (docs/learning/api.md, decision 0309): links that share a course's draft with
-- colleagues for review, and the comments they leave through them.
--
-- workspace_id and the people columns get their foreign keys in a later learning migration, once the
-- `workspaces` table is on main.

CREATE TABLE learning_review_links (
  workspace_id uuid NOT NULL,
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  course_id text NOT NULL,
  -- The SHA-256 of the link's token, in hex. The token itself is shown once and never stored.
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  -- Set when an author stops sharing the link; its comments stay.
  stopped_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, course_id) REFERENCES learning_courses (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX learning_review_links_course ON learning_review_links (workspace_id, course_id);

CREATE TABLE learning_review_comments (
  workspace_id uuid NOT NULL,
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  course_id text NOT NULL,
  link_id text NOT NULL,
  -- On a lesson, or on one block (content lessons) or question (quiz lessons) in it.
  lesson_id text NOT NULL CHECK (lesson_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  block_id text CHECK (block_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  question_id text CHECK (question_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  PRIMARY KEY (workspace_id, id),
  CHECK (block_id IS NULL OR question_id IS NULL),
  FOREIGN KEY (workspace_id, course_id) REFERENCES learning_courses (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, link_id) REFERENCES learning_review_links (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX learning_review_comments_course ON learning_review_comments (workspace_id, course_id, created_at);
CREATE INDEX learning_review_comments_link ON learning_review_comments (workspace_id, link_id, created_at);
