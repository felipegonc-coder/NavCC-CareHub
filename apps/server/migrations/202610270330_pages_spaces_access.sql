-- Spaces, pages and who can open them (decision 0012; names in decision 0007, sections 3.3 and 4.1;
-- spaces as in the Sidebar spec, section 4).

-- Open, Closed and Private team spaces, and each person's own Private section ('personal').
CREATE TABLE spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('open', 'closed', 'private', 'personal')),
  owner_id uuid REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  icon jsonb,
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  -- What members get on the pages that inherit. Space owners and Admins get full.
  default_access text NOT NULL DEFAULT 'edit'
    CHECK (default_access IN ('view', 'comment', 'edit', 'full')),
  owners_only_top_level boolean NOT NULL DEFAULT false,
  allow_share_links boolean NOT NULL DEFAULT true,
  allow_guests boolean NOT NULL DEFAULT true,
  allow_export boolean NOT NULL DEFAULT true,
  allow_move_out boolean NOT NULL DEFAULT true,
  -- New members join default spaces.
  is_default boolean NOT NULL DEFAULT false,
  archived_by uuid REFERENCES users (id) ON DELETE SET NULL,
  archived_at timestamptz,
  deleted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK ((kind = 'personal') = (owner_id IS NOT NULL))
);

CREATE UNIQUE INDEX spaces_personal_idx ON spaces (workspace_id, owner_id) WHERE kind = 'personal';
CREATE UNIQUE INDEX spaces_name_idx ON spaces (workspace_id, lower(name))
  WHERE kind <> 'personal' AND deleted_at IS NULL;

-- People and groups in a team space. Guests can't join spaces.
CREATE TABLE space_members (
  space_id uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'group')),
  principal_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  added_by uuid REFERENCES users (id) ON DELETE SET NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, principal_type, principal_id)
);

CREATE INDEX space_members_principal_idx ON space_members (principal_id);

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
  -- Font, small text, backlinks, page comments and floating contents.
  style jsonb NOT NULL DEFAULT '{}',
  inherit_access boolean NOT NULL DEFAULT true,
  -- Fractional sort key among siblings; the "C" collation compares it like plain strings.
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

-- Grants on a space or page to a person (member or guest), a role, a group or everyone in the
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

-- One grant per place and principal ('everyone' has no principal_id).
CREATE UNIQUE INDEX access_grants_one_idx ON access_grants (coalesce(space_id, page_id),
  principal_type, coalesce(principal_id, '00000000-0000-0000-0000-000000000000'));
CREATE INDEX access_grants_page_idx ON access_grants (page_id) WHERE page_id IS NOT NULL;
CREATE INDEX access_grants_space_idx ON access_grants (space_id) WHERE space_id IS NOT NULL;
CREATE INDEX access_grants_principal_idx ON access_grants (principal_id);

-- Every grant change, for Settings → Roles → History. It outlives the pages, people and grants it
-- names, so only the workspace is a foreign key.
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
