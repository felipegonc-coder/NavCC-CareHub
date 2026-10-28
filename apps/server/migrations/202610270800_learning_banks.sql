-- Learning question banks (B9, docs/learning/api.md): questions kept once that quizzes in many courses draw
-- from. Publishing a course copies the questions it draws into that version (banks/publish.ts), so changing or
-- deleting a bank never changes a live course.
--
-- workspace_id and created_by get their foreign keys in a later learning migration, once the `workspaces`
-- table is on main.

CREATE TABLE learning_banks (
  workspace_id uuid NOT NULL,
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- A QuestionBank (packages/learning/src/banks/bank.ts), checked by the server before it is saved.
  bank jsonb NOT NULL CHECK (jsonb_typeof(bank) = 'object'),
  -- Goes up by one with every save; a save names the revision it started from (decision 0304).
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
