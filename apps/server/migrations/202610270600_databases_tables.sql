-- Databases and forms storage (decision 0200). A database is a page of kind 'database' and each row
-- a page of kind 'row' under it (decision 0007): titles, icons, content, Trash and sharing live on
-- the page; these tables hold the rest. Property, view and template ids are the package's text ids.

-- One per database page: its properties, views, templates and settings. Settings writes lock this
-- row (select ... for no key update) and bump `version`; row writes never lock it.
CREATE TABLE db_databases (
  page_id uuid PRIMARY KEY REFERENCES pages (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- The description under the title (rich text).
  description jsonb NOT NULL DEFAULT '[]',
  properties jsonb NOT NULL DEFAULT '[]',
  views jsonb NOT NULL DEFAULT '[]',
  templates jsonb NOT NULL DEFAULT '[]',
  access_rules jsonb NOT NULL DEFAULT '[]',
  default_template_id text,
  -- Lock structure: properties, views, forms and templates can't change; rows can.
  locked boolean NOT NULL DEFAULT false,
  row_page_layout jsonb,
  sub_items jsonb,
  dependencies jsonb,
  -- Deleted properties and their values, kept 30 days for restore: { property, deletedAt, values }[].
  deleted_properties jsonb NOT NULL DEFAULT '[]',
  next_unique_number integer NOT NULL DEFAULT 1 CHECK (next_unique_number >= 1),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX db_databases_workspace_idx ON db_databases (workspace_id);

-- One per row page. Templates' pages (kind 'row', no entry here) never show as rows.
CREATE TABLE db_rows (
  page_id uuid PRIMARY KEY REFERENCES pages (id) ON DELETE CASCADE,
  database_id uuid NOT NULL REFERENCES db_databases (page_id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- Property id -> stored value for that property's type.
  "values" jsonb NOT NULL DEFAULT '{}',
  unique_number integer,
  -- null: an anonymous form response.
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_by uuid REFERENCES users (id) ON DELETE SET NULL,
  edited_at timestamptz NOT NULL DEFAULT now(),
  -- The form (view id) that made the row, if any.
  form_view_id text,
  import_id uuid
);

CREATE INDEX db_rows_database_idx ON db_rows (database_id);
CREATE INDEX db_rows_unique_number_idx ON db_rows (database_id, unique_number);
-- Reverse relation lookups (rows whose relation value names a row).
CREATE INDEX db_rows_values_idx ON db_rows USING gin ("values");
-- One response per person for forms that allow one.
CREATE INDEX db_rows_form_idx ON db_rows (form_view_id, created_by) WHERE form_view_id IS NOT NULL;

-- Row history (kept 90 days).
CREATE TABLE db_row_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id uuid NOT NULL REFERENCES db_rows (page_id) ON DELETE CASCADE,
  database_id uuid NOT NULL REFERENCES db_databases (page_id) ON DELETE CASCADE,
  "at" timestamptz NOT NULL DEFAULT now(),
  -- null: anonymous.
  "by" uuid REFERENCES users (id) ON DELETE SET NULL,
  property_id text NOT NULL,
  "before" jsonb,
  "after" jsonb
);

CREATE INDEX db_row_changes_row_idx ON db_row_changes (row_id, "at");
CREATE INDEX db_row_changes_at_idx ON db_row_changes ("at");

-- CSV and Excel imports, for Undo and their problem reports.
CREATE TABLE db_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id uuid NOT NULL REFERENCES db_databases (page_id) ON DELETE CASCADE,
  "by" uuid REFERENCES users (id) ON DELETE SET NULL,
  upload_id uuid,
  status text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  problems jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);

CREATE INDEX db_imports_database_idx ON db_imports (database_id, created_at);

ALTER TABLE db_rows
  ADD FOREIGN KEY (import_id) REFERENCES db_imports (id) ON DELETE SET NULL;
CREATE INDEX db_rows_import_idx ON db_rows (import_id) WHERE import_id IS NOT NULL;

-- Button presses, for Undo and the run log (newest 50 per button).
CREATE TABLE db_button_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id uuid NOT NULL REFERENCES db_databases (page_id) ON DELETE CASCADE,
  row_id uuid REFERENCES db_rows (page_id) ON DELETE CASCADE,
  property_id text NOT NULL,
  "by" uuid REFERENCES users (id) ON DELETE SET NULL,
  "at" timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL,
  changes jsonb NOT NULL DEFAULT '[]'
);

CREATE INDEX db_button_runs_button_idx ON db_button_runs (database_id, property_id, "at");

-- Repeating templates: when each runs next.
CREATE TABLE db_repeat_state (
  template_id text PRIMARY KEY,
  database_id uuid NOT NULL REFERENCES db_databases (page_id) ON DELETE CASCADE,
  next_run_at timestamptz,
  last_run_at timestamptz,
  paused_reason text
);

CREATE INDEX db_repeat_state_due_idx ON db_repeat_state (next_run_at) WHERE paused_reason IS NULL;
CREATE INDEX db_repeat_state_database_idx ON db_repeat_state (database_id);

-- Date reminders on rows.
CREATE TABLE db_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id uuid NOT NULL REFERENCES db_rows (page_id) ON DELETE CASCADE,
  property_id text NOT NULL,
  fire_at timestamptz NOT NULL,
  sent_at timestamptz
);

CREATE INDEX db_reminders_due_idx ON db_reminders (fire_at) WHERE sent_at IS NULL;
CREATE INDEX db_reminders_row_idx ON db_reminders (row_id);

-- Form link codes: one live code per form; "Change link" revokes the old one.
CREATE TABLE forms_links (
  code text PRIMARY KEY,
  database_id uuid NOT NULL REFERENCES db_databases (page_id) ON DELETE CASCADE,
  view_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX forms_links_live_idx ON forms_links (database_id, view_id) WHERE revoked_at IS NULL;
