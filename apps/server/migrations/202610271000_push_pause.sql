-- "Pause notifications" (Settings and members spec, 3.3): nothing notifies the person until
-- paused_until, or until they turn notifications back on when it's empty. Notices still arrive
-- in the 🔔 chat. Not paused while paused_at is empty.
ALTER TABLE push_preferences
  ADD COLUMN paused_at timestamptz,
  ADD COLUMN paused_until timestamptz,
  ADD CONSTRAINT push_preferences_pause_check CHECK (paused_until IS NULL OR paused_at IS NOT NULL);
