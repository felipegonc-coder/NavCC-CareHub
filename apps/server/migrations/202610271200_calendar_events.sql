-- Calendar: Care Hub events (My events and Meetings), the people invited and their replies.

CREATE TABLE cal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Its foreign key to workspaces is added in 202610271300.
  workspace_id uuid NOT NULL,
  organizer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  video_url text,
  all_day boolean NOT NULL,
  -- The IANA time zone of the civil values below.
  time_zone text NOT NULL,
  -- The first occurrence: dates ('YYYY-MM-DD', end exclusive) or 'YYYY-MM-DDTHH:mm' in time_zone.
  start_civil text NOT NULL,
  end_civil text NOT NULL,
  -- The @carehub/team-repeat rule (null: no repeat), removed occurrences and changed ones.
  repeat_rule jsonb,
  exceptions jsonb NOT NULL DEFAULT '[]',
  overrides jsonb NOT NULL DEFAULT '{}',
  -- Real-time bounds for range queries, a day wider for all-day dates. Null range_end: no end.
  range_start timestamptz NOT NULL,
  range_end timestamptz,
  notes_page_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT cal_events_title_length CHECK (char_length(title) <= 1000),
  CONSTRAINT cal_events_location_length CHECK (char_length(location) <= 1000),
  CONSTRAINT cal_events_description_length CHECK (char_length(description) <= 8000)
);

CREATE INDEX cal_events_organizer_range_idx ON cal_events (organizer_id, range_start)
  WHERE cancelled_at IS NULL;

CREATE TABLE cal_event_people (
  event_id uuid NOT NULL REFERENCES cal_events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The answer for the whole series. Null: no reply yet.
  reply text,
  note text,
  -- Answers for single occurrences (Just this event): { "<occurrence key>": { reply, note } }.
  occurrence_replies jsonb NOT NULL DEFAULT '{}',
  invited_at timestamptz NOT NULL DEFAULT now(),
  replied_at timestamptz,
  PRIMARY KEY (event_id, user_id),
  CONSTRAINT cal_event_people_reply_check CHECK (reply IN ('going', 'maybe', 'not-going')),
  CONSTRAINT cal_event_people_note_length CHECK (char_length(note) <= 200)
);

CREATE INDEX cal_event_people_user_idx ON cal_event_people (user_id);
