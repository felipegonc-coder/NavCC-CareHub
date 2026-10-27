-- Learning paths (docs/learning/api.md): courses to take one after another, or in any order,
-- built in Studio. Learners only see the courses of a path they can open, and the path's
-- assignments follow its published courses (assignments' syncPathAssignments).
--
-- workspace_id, created_by and updated_by get their foreign keys in a later learning migration,
-- once the `workspaces` table is on main (as for learning_courses).

CREATE TABLE learning_paths (
  workspace_id uuid NOT NULL,
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  title text NOT NULL CHECK (title <> ''),
  description text,
  -- The path's course ids, in path order and each once (LearningPath.courseIds).
  course_ids text[] NOT NULL DEFAULT '{}',
  course_order text NOT NULL DEFAULT 'sequential' CHECK (course_order IN ('sequential', 'free')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

-- The paths that hold a course, found when it is published.
CREATE INDEX learning_paths_course_ids_idx ON learning_paths USING gin (course_ids);
