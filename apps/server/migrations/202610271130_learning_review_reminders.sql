-- Review-due reminders (docs/learning/api.md, Jobs, decision 0313): authors are reminded to check a
-- live course every `settings.reviewEveryMonths` months. One row per reminder sent, claimed before it
-- is sent, so each goes out once.
--
-- workspace_id and user_id get their foreign keys in a later learning migration, once the `workspaces` table
-- is on main.

CREATE TABLE learning_review_reminders (
  workspace_id uuid NOT NULL,
  course_id text NOT NULL,
  -- The day the reminder was due, and the author's own calendar day when it went out.
  due_on date NOT NULL,
  sent_on date NOT NULL,
  user_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, course_id, due_on),
  FOREIGN KEY (workspace_id, course_id) REFERENCES learning_courses (workspace_id, id) ON DELETE CASCADE
);
