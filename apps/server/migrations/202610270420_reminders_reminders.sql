-- Reminders: Remind me on pages and events, sent to the owner's 🔔 Care Hub chat (Home and
-- reminders spec, sections 3 and 4). Only the owner sees, changes or gets one (HR-12).
--
-- workspace_id gets its foreign key in a later reminders migration, once `workspaces` is on main.

CREATE TABLE reminders_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- What it's for: a page, or an event (and one occurrence of a repeating event, named as
  -- Calendar names it).
  target_type text NOT NULL CHECK (target_type IN ('page', 'event')),
  page_id uuid,
  event_id text,
  occurrence_start text,
  -- Event reminders: minutes before the start, so they move with the event. Null: a fixed time.
  minutes_before integer,
  due_at timestamptz NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 280),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'snoozed', 'sent', 'done', 'deleted')),
  -- The owner's time settings when they last set it, for "Late: was due at…" and Snooze.
  time_zone text NOT NULL,
  use_24h boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminders_reminders_target_check CHECK (
    (target_type = 'page' AND page_id IS NOT NULL AND event_id IS NULL
      AND occurrence_start IS NULL AND minutes_before IS NULL)
    OR (target_type = 'event' AND event_id IS NOT NULL AND page_id IS NULL
      AND minutes_before IS NOT NULL)
  )
);

-- The Reminders list and the limit of 500 pending per person.
CREATE INDEX reminders_reminders_pending_idx ON reminders_reminders (user_id, workspace_id, due_at)
  WHERE status IN ('pending', 'snoozed');

-- Sent in the last 30 days.
CREATE INDEX reminders_reminders_sent_idx ON reminders_reminders (user_id, workspace_id, sent_at)
  WHERE status IN ('sent', 'done');

-- An event's reminders, when it moves or is deleted.
CREATE INDEX reminders_reminders_event_idx ON reminders_reminders (event_id)
  WHERE event_id IS NOT NULL AND status <> 'deleted';
