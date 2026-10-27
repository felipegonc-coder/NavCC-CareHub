-- Templates: workspace templates saved from pages, starters hidden by Admins, and the pages made
-- from templates (Templates and buttons spec, sections 3.1 and 4; decision 0400).
--
-- A template keeps its own copy of each page (title, icon and the collab feature's Markdown, with
-- links between its pages as tokens), apart from the page tree, so changing or deleting a template
-- never changes pages made from it, and templates never show in the tree or in search.
-- workspace_id, space_id and page_id get their foreign keys in a later templates migration, once
-- the `workspaces`, `spaces` and `pages` tables are on main.

CREATE TABLE tpl_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
  category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 40),
  -- Who can use it: everyone in the workspace, the members of one space, or only its maker.
  audience text NOT NULL CHECK (audience IN ('everyone', 'space', 'me')),
  space_id uuid,
  icon jsonb,
  sub_page_count integer NOT NULL DEFAULT 0 CHECK (sub_page_count BETWEEN 0 AND 499),
  database_count integer NOT NULL DEFAULT 0 CHECK (database_count >= 0),
  sample_row_count integer NOT NULL DEFAULT 0 CHECK (sample_row_count >= 0),
  -- "Templates can hold up to 500 pages and 1 GB."
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes BETWEEN 0 AND 1073741824),
  times_used integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tpl_templates_space_check CHECK ((audience = 'space') = (space_id IS NOT NULL))
);

CREATE INDEX tpl_templates_workspace_idx ON tpl_templates (workspace_id, name);

-- A template's pages: key 0 is the top page; the others hang under it in their order.
CREATE TABLE tpl_template_pages (
  template_id uuid NOT NULL REFERENCES tpl_templates (id) ON DELETE CASCADE,
  key integer NOT NULL CHECK (key BETWEEN 0 AND 499),
  parent_key integer,
  position integer NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'database')),
  is_inline boolean NOT NULL DEFAULT false,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 2000),
  icon jsonb,
  markdown text NOT NULL DEFAULT '',
  -- Databases: the database copied on use (with its rows unless they're left out).
  source_page_id uuid,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  PRIMARY KEY (template_id, key),
  CONSTRAINT tpl_template_pages_parent_check CHECK ((key = 0) = (parent_key IS NULL)),
  CONSTRAINT tpl_template_pages_database_check CHECK ((kind = 'database') = (source_page_id IS NOT NULL))
);

-- Care Hub starters an Admin hid for everyone (card menu → Hide for everyone).
CREATE TABLE tpl_hidden_starters (
  workspace_id uuid NOT NULL,
  starter_key text NOT NULL CHECK (starter_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(starter_key) <= 60),
  hidden_by uuid REFERENCES users (id) ON DELETE SET NULL,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, starter_key)
);

-- "Made from Weekly huddle" in a page's Updates. The name is kept: templates can be deleted.
CREATE TABLE tpl_made_from (
  page_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  template_id uuid REFERENCES tpl_templates (id) ON DELETE SET NULL,
  starter_key text,
  template_name text NOT NULL CHECK (char_length(template_name) BETWEEN 1 AND 100),
  used_by uuid REFERENCES users (id) ON DELETE SET NULL,
  used_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tpl_made_from_source_check CHECK (template_id IS NULL OR starter_key IS NULL)
);
