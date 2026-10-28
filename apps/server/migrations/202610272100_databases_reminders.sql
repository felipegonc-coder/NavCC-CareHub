-- Date reminders: one entry per person, since a date without a time reminds at 9:00 AM in each
-- person's own time zone. Nothing writes db_reminders before this, so the column can be NOT NULL.
ALTER TABLE db_reminders
  ADD COLUMN user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE;

-- A person gets a reminder for a moment once, however often the row is saved.
CREATE UNIQUE INDEX db_reminders_once_idx ON db_reminders (row_id, property_id, user_id, fire_at);

-- Sent entries are deleted a day after their time.
CREATE INDEX db_reminders_sent_idx ON db_reminders (fire_at) WHERE sent_at IS NOT NULL;
