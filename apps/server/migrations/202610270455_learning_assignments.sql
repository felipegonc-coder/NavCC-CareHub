-- Learning assignments (B4, docs/learning/api.md): which people and groups must take which course, and by
-- when. Assigning a learning path stores one row per published course on it, with path_id set.
--
-- workspace_id and created_by get their foreign keys in a later learning migration, once the `workspaces`
-- table is on main. People in user_ids are checked by the server (an array can't have a foreign key).

CREATE TABLE learning_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  course_id text NOT NULL CHECK (course_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  path_id text CHECK (path_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- People assigned by name, and groups whose members get it (today's members and anyone who joins later).
  user_ids uuid[] NOT NULL DEFAULT '{}',
  group_ids text[] NOT NULL DEFAULT '{}',
  -- Due on a calendar day, or a number of days after each person gets it, or neither.
  due_date date,
  due_in_days integer CHECK (due_in_days BETWEEN 1 AND 3650),
  -- Optional courses get only the "assigned" reminder.
  required boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date IS NULL OR due_in_days IS NULL),
  CHECK (cardinality(user_ids) + cardinality(group_ids) > 0)
);

CREATE INDEX learning_assignments_course ON learning_assignments (workspace_id, course_id);

-- The day each person got an assignment that is due a number of days later: when it was made, or for
-- someone who joined one of its groups afterwards, the first day Learning saw them in it.
CREATE TABLE learning_assignment_learners (
  assignment_id uuid NOT NULL REFERENCES learning_assignments (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  since date NOT NULL,
  PRIMARY KEY (assignment_id, user_id)
);
