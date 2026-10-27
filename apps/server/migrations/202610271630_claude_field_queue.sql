-- Claude fields' background fills (docs/extras/claude.md, "Claude fields"). Holds no text from a
-- row or from Claude.
--
-- claude_field_queue: rows waiting to fill in the background, 5 at a time. By hand: for the person
-- who asked, and gone with them. Automatically: as the field's owner, 2 minutes after the row's last
-- change, so a row being edited fills once.
--
-- workspace_id, database_id and row_id get their foreign keys in a later claude migration, once
-- `workspaces` and `pages` are on main.

CREATE TABLE claude_field_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  database_id uuid NOT NULL,
  property_id text NOT NULL,
  row_id uuid NOT NULL,
  auto boolean NOT NULL,
  requested_by uuid REFERENCES users (id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Goes up with each change, so a fill that started earlier doesn't remove the newer request.
  version integer NOT NULL DEFAULT 1,
  CHECK (auto = (requested_by IS NULL))
);

CREATE UNIQUE INDEX claude_field_queue_row_idx
  ON claude_field_queue (database_id, property_id, row_id);
CREATE INDEX claude_field_queue_due_idx ON claude_field_queue (due_at);
CREATE INDEX claude_field_queue_requested_idx ON claude_field_queue (requested_by);
