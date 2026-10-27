-- Learning progress (B3, docs/learning/api.md): what each learner did in each course, kept as the
-- events their browser sent (decision 0303), plus the changes trainers made by hand. The server
-- works out each learner's state from the events of their current run, measured against the
-- course version that run is pinned to (decision 0311). Nothing here stores a score or a
-- completion that a browser sent.
--
-- workspace_id, learner_id and changed_by get their foreign keys in a later learning migration,
-- once the `workspaces` table is on main (as for learning_courses).

CREATE TABLE learning_progress (
  workspace_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  course_id text NOT NULL,
  -- Goes up by one each time the learner's progress starts over: a reset, or a retake asked for
  -- when a new version was published. Earlier runs' events are kept but no longer count.
  run integer NOT NULL DEFAULT 1 CHECK (run >= 1),
  -- When the current run began (null for the first). Events dated before it are refused.
  run_started_at timestamptz,
  -- The course version the current run is measured against: the live version when the run
  -- began, or a newer one it moved to when the author said "tell" (decision 0311).
  version integer NOT NULL CHECK (version >= 1),
  -- When someone with learning.assign marked the current run complete (decision 0312).
  marked_complete_at timestamptz,
  -- The state the server worked out from the run's events, saved each time they change so that
  -- reports and publishing can read it without replaying events.
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'passed', 'failed')),
  percent_complete integer NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
  score double precision CHECK (score BETWEEN 0 AND 100),
  active_seconds integer NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  last_activity_at timestamptz,
  -- The lesson the learner opened last, for drop-off reports.
  last_lesson_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, learner_id, course_id)
);

CREATE INDEX learning_progress_course_idx ON learning_progress (workspace_id, course_id);

CREATE TABLE learning_progress_events (
  workspace_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  course_id text NOT NULL,
  -- The id the browser gave the event: the same event sent twice is stored once.
  event_id text NOT NULL,
  run integer NOT NULL CHECK (run >= 1),
  -- A ProgressEvent (packages/learning, progress/schema.ts), checked before it is stored.
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, learner_id, course_id, event_id),
  FOREIGN KEY (workspace_id, learner_id, course_id)
    REFERENCES learning_progress (workspace_id, learner_id, course_id) ON DELETE CASCADE
);

CREATE INDEX learning_progress_events_run_idx
  ON learning_progress_events (workspace_id, learner_id, course_id, run);

-- Resets and completions by trainers, and retakes asked for by publishing, with the note given.
CREATE TABLE learning_progress_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  course_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reset', 'complete', 'retake')),
  -- The run the change started (reset, retake) or completed (complete).
  run integer NOT NULL CHECK (run >= 1),
  -- Who did it; null for a retake, which the course version's publisher asked for.
  changed_by uuid,
  note text CHECK (char_length(note) <= 500),
  changed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, learner_id, course_id)
    REFERENCES learning_progress (workspace_id, learner_id, course_id) ON DELETE CASCADE
);

CREATE INDEX learning_progress_changes_learner_idx
  ON learning_progress_changes (workspace_id, learner_id, course_id, changed_at);
