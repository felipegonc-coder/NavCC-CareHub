-- Learning block templates (B1, docs/learning/api.md): blocks an author saved to add again in any course of the
-- workspace. workspace_id and created_by get their foreign keys with the course tables' (a later migration).

CREATE TABLE learning_block_templates (
  workspace_id uuid NOT NULL,
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  -- Block[] (docs/learning/course-format.md), checked by the server before it is saved.
  blocks jsonb NOT NULL CHECK (jsonb_typeof(blocks) = 'array'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
