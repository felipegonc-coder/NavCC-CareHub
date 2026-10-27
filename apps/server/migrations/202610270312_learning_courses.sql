-- Learning courses (B1, docs/learning/api.md): each course's draft in Studio, and every version published
-- from it. Learners always get the live version; a draft never reaches them.
--
-- workspace_id, created_by and published_by get their foreign keys in a later learning migration, once the
-- `workspaces` table is on main.

CREATE TABLE learning_courses (
  workspace_id uuid NOT NULL,
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- A Course (docs/learning/course-format.md), checked by the server before it is saved.
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  -- Goes up by one with every save; a save names the revision it started from.
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  -- The version learners get, and the draft revision it matches (both null until the first publish).
  live_version integer CHECK (live_version >= 1),
  published_revision integer,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE learning_course_versions (
  workspace_id uuid NOT NULL,
  course_id text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  -- The course as published, with each question bank draw's questions copied in.
  course jsonb NOT NULL CHECK (jsonb_typeof(course) = 'object'),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid NOT NULL,
  notify text NOT NULL CHECK (notify IN ('none', 'tell', 'retake')),
  note text,
  -- Set when this version is a copy of an earlier one (roll back).
  rolled_back_from integer,
  PRIMARY KEY (workspace_id, course_id, version),
  FOREIGN KEY (workspace_id, course_id) REFERENCES learning_courses (workspace_id, id) ON DELETE CASCADE
);
