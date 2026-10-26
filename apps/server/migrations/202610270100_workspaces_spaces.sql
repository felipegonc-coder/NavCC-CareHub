-- Spaces: team spaces and one private space per person.
-- Access rules: docs/decisions/0005-spaces-and-page-access.md.

CREATE TABLE spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  icon jsonb,
  kind text NOT NULL CHECK (kind IN ('team', 'private')),
  owner_id uuid REFERENCES users (id) ON DELETE CASCADE,
  visibility text CHECK (visibility IN ('workspace', 'members')),
  -- Fractional sort key; "C" collation makes Postgres order it like plain string comparison.
  position text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK (
    (kind = 'team' AND owner_id IS NULL AND visibility IS NOT NULL)
    OR (kind = 'private' AND owner_id IS NOT NULL AND visibility IS NULL)
  )
);

CREATE UNIQUE INDEX spaces_one_private_space_idx ON spaces (workspace_id, owner_id)
  WHERE kind = 'private';

-- Who is in a members-only team space, and with which role.
CREATE TABLE space_members (
  space_id uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  PRIMARY KEY (space_id, user_id)
);

CREATE INDEX space_members_user_id_idx ON space_members (user_id);
