-- Spaces, pages and access grants (decision 0005; contract in decision 0007, sections 3.3 and 4.1).

-- Team spaces, and one private space per person and workspace (only its owner can open it).
CREATE TABLE spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('team', 'private')),
  owner_id uuid REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  icon jsonb,
  -- Fractional sort key; the "C" collation sorts it like plain string comparison.
  position text COLLATE "C" NOT NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK ((kind = 'private') = (owner_id IS NOT NULL))
);

CREATE UNIQUE INDEX spaces_private_owner_idx ON spaces (workspace_id, owner_id)
  WHERE kind = 'private';

-- Pages, databases and database rows. IDs never change, so links (/p/<id>) never break.
CREATE TABLE pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  space_id uuid NOT NULL,
  parent_id uuid,
  kind text NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'database', 'row')),
  is_inline boolean NOT NULL DEFAULT false,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 2000),
  icon jsonb,
  cover jsonb,
  cover_position smallint NOT NULL DEFAULT 50 CHECK (cover_position BETWEEN 0 AND 100),
  full_width boolean NOT NULL DEFAULT false,
  -- Font, small text, text direction, backlinks, page comments and floating contents.
  style jsonb NOT NULL DEFAULT '{}',
  inherit_access boolean NOT NULL DEFAULT true,
  position text COLLATE "C" NOT NULL,
  locked_by uuid REFERENCES users (id) ON DELETE SET NULL,
  locked_at timestamptz,
  archived_by uuid REFERENCES users (id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  deleted_at timestamptz,
  -- In Trash: the page whose move to Trash took this one along (they're restored together).
  trash_root_id uuid,
  UNIQUE (space_id, id),
  FOREIGN KEY (workspace_id, space_id) REFERENCES spaces (workspace_id, id) ON DELETE CASCADE,
  CHECK (parent_id <> id),
  CHECK (kind <> 'row' OR parent_id IS NOT NULL),
  CHECK (NOT is_inline OR (kind = 'database' AND parent_id IS NOT NULL))
);

-- A parent is always in the same space. Deleting a page for good deletes everything under it.
ALTER TABLE pages
  ADD FOREIGN KEY (space_id, parent_id) REFERENCES pages (space_id, id) ON DELETE CASCADE;

CREATE INDEX pages_parent_idx ON pages (parent_id);
CREATE INDEX pages_live_tree_idx ON pages (space_id, parent_id, position) WHERE deleted_at IS NULL;

-- Who can open a space or page: a person (member or guest), a role, a group or everyone in the
-- workspace. 'edit_content' and 'rows_only' are only given on databases.
CREATE TABLE access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id uuid REFERENCES spaces (id) ON DELETE CASCADE,
  page_id uuid REFERENCES pages (id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'role', 'group', 'everyone')),
  principal_id uuid,
  level text NOT NULL CHECK (level IN ('view', 'comment', 'edit_content', 'edit', 'full', 'rows_only')),
  granted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((space_id IS NULL) <> (page_id IS NULL)),
  CHECK ((principal_type = 'everyone') = (principal_id IS NULL))
);

-- One grant per place and principal.
CREATE UNIQUE INDEX access_grants_one_idx ON access_grants (
  coalesce(space_id, page_id),
  principal_type,
  coalesce(principal_id, '00000000-0000-0000-0000-000000000000')
);
CREATE INDEX access_grants_page_idx ON access_grants (page_id) WHERE page_id IS NOT NULL;
CREATE INDEX access_grants_space_idx ON access_grants (space_id) WHERE space_id IS NOT NULL;
CREATE INDEX access_grants_principal_idx ON access_grants (principal_id);

-- Every grant change, for Settings → Roles → History. No foreign keys: it outlives what it names.
CREATE TABLE access_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  changed_by uuid,
  space_id uuid,
  page_id uuid,
  principal_type text NOT NULL,
  principal_id uuid,
  -- Levels before and after the change; null means no grant.
  before_level text,
  after_level text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_history_workspace_idx ON access_history (workspace_id, created_at);
