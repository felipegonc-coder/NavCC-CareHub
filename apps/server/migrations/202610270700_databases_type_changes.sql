-- Type changes kept for Undo (decision 0200; Databases spec 3.4). Changing a property's type keeps
-- the property as it was, its values and the settings the change turned off for 10 minutes, so Undo
-- can put them back exactly. Only the person who made the change can undo it, newest first for each
-- property. Expired entries are pruned as later changes are made. They're never listed as deleted.
CREATE TABLE db_type_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id uuid NOT NULL REFERENCES db_databases (page_id) ON DELETE CASCADE,
  property_id text NOT NULL,
  changed_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  -- The property before the change.
  property jsonb NOT NULL,
  -- Row id -> its value before the change, for the rows that had one.
  "values" jsonb NOT NULL DEFAULT '{}',
  -- Sub-items, dependencies and the row page layout as they were, where the change turned them off.
  settings jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX db_type_changes_property_idx ON db_type_changes (database_id, property_id, changed_at);
CREATE INDEX db_type_changes_changed_at_idx ON db_type_changes (changed_at);
