-- Workspaces, their roles and their members (Roles and permissions). Care Hub has one workspace for now.

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- The current workspace while Care Hub has only one.
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_name_length CHECK (char_length(name) BETWEEN 1 AND 65)
);

CREATE UNIQUE INDEX workspaces_default_key ON workspaces (is_default) WHERE is_default;

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- admin, editor, commenter or viewer for the built-in roles (kept in step with the code); null for custom ones.
  builtin_key text,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT roles_workspace_builtin_key UNIQUE (workspace_id, builtin_key),
  CONSTRAINT roles_builtin_key_check CHECK (builtin_key IN ('admin', 'editor', 'commenter', 'viewer')),
  CONSTRAINT roles_name_length CHECK (char_length(name) BETWEEN 1 AND 40),
  -- Admin settings belong to the built-in Admin role only.
  CONSTRAINT roles_custom_not_admin CHECK (builtin_key IS NOT NULL OR NOT ('workspace.admin' = ANY (permissions)))
);

CREATE UNIQUE INDEX roles_workspace_name_key ON roles (workspace_id, lower(name));

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'member',
  -- Members have exactly one role. Guests have none: they reach only what's shared with them.
  role_id uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  -- The role belongs to the same workspace. A role that people have can't be deleted.
  CONSTRAINT workspace_members_role_fkey FOREIGN KEY (workspace_id, role_id) REFERENCES roles (workspace_id, id),
  CONSTRAINT workspace_members_kind_check CHECK (kind IN ('member', 'guest')),
  CONSTRAINT workspace_members_role_check CHECK ((kind = 'member') = (role_id IS NOT NULL))
);

CREATE INDEX workspace_members_user_id_idx ON workspace_members (user_id);
CREATE INDEX workspace_members_role_id_idx ON workspace_members (role_id);
