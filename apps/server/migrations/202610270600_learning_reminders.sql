-- Learning reminders that went out (B4): one row per person, course, kind and day, written just before
-- the notice is sent, so the reminders job never sends the same reminder twice. sent_on is the day in
-- Care Hub's time zone.
--
-- workspace_id gets its foreign key in a later learning migration, once the `workspaces` table is on
-- main.

CREATE TABLE learning_reminders_sent (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  course_id text NOT NULL CHECK (course_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  kind text NOT NULL CHECK (kind IN ('assigned', 'due_soon', 'overdue')),
  sent_on date NOT NULL,
  PRIMARY KEY (workspace_id, user_id, course_id, kind, sent_on)
);
