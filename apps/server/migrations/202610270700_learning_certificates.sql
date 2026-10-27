-- Learning certificates (B3, docs/learning/api.md): one for each finish of a course that has
-- certificates switched on, with a code that can be checked. A certificate keeps the learner's
-- name, the course title and the dates from when it was issued. Whether it is valid, expiring
-- soon or expired depends on the day, so the server works that out each time it is read.
--
-- workspace_id and learner_id get their foreign keys in a later learning migration, once the
-- `workspaces` table is on main (as for learning_courses).

CREATE TABLE learning_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  -- "XXXX-XXXX-XXXX" (createCertificateCode in packages/learning). Unique everywhere, so looking
  -- a code up finds at most one certificate.
  code text NOT NULL UNIQUE
    CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  learner_id uuid NOT NULL,
  learner_name text NOT NULL,
  course_id text NOT NULL,
  -- The title of the course version the learner finished.
  course_title text NOT NULL,
  course_version integer NOT NULL CHECK (course_version >= 1),
  -- When the learner passed or completed the course: each finish gets at most one certificate.
  completed_at timestamptz NOT NULL,
  -- The calendar day of completed_at in the learner's time zone.
  issued_on date NOT NULL,
  -- Null when the course sets no expiry.
  expires_on date CHECK (expires_on > issued_on),
  score double precision CHECK (score BETWEEN 0 AND 100),
  -- The day the course was assigned to the learner again for re-certification (once).
  reassigned_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, learner_id, course_id, completed_at)
);

CREATE INDEX learning_certificates_course_idx ON learning_certificates (workspace_id, course_id);

-- For the daily expiry job.
CREATE INDEX learning_certificates_expiry_idx
  ON learning_certificates (expires_on) WHERE expires_on IS NOT NULL;

-- The expiry notices sent for each certificate: each kind goes out once.
CREATE TABLE learning_certificate_notices (
  certificate_id uuid NOT NULL REFERENCES learning_certificates (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('expiring_soon', 'expired')),
  sent_on date NOT NULL,
  PRIMARY KEY (certificate_id, kind)
);
