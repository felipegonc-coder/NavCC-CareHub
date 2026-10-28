-- Meetings: notes pages for event occurrences (Meetings spec, sections 3 and 4). workspace_id,
-- page_id, grant_id and parent_page_id get their foreign keys in a later meetings migration, once
-- `workspaces`, `pages` and `access_grants` are on main.

-- A meeting notes block: its page, the event occurrence it's linked to (or none), the "Also
-- attended" people and who made it. The sections are part of the page.
CREATE TABLE meetings_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  -- Calendar's event and occurrence key ('' when it doesn't repeat); both null when standalone.
  event_id text CHECK (char_length(event_id) BETWEEN 1 AND 100),
  occurrence_key text CHECK (char_length(occurrence_key) <= 40),
  also_attended uuid[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meetings_notes_event_check CHECK ((event_id IS NULL) = (occurrence_key IS NULL))
);

-- One notes page per occurrence, also when two people click at once (MT-01).
CREATE UNIQUE INDEX meetings_notes_occurrence_idx
  ON meetings_notes (workspace_id, event_id, occurrence_key) WHERE event_id IS NOT NULL;

-- The Can edit an event gave each workspace attendee (MT-D1), apart from other shares, so only
-- it goes when someone leaves the event.
CREATE TABLE meetings_grants (
  notes_id uuid NOT NULL REFERENCES meetings_notes (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  grant_id uuid NOT NULL,
  PRIMARY KEY (notes_id, user_id)
);

-- Where each person's new notes pages go: their "Meeting notes" page.
CREATE TABLE meetings_places (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  parent_page_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
