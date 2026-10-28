-- Button blocks ("/button") in pages: their settings and their last runs (Templates and buttons
-- spec, sections 3.4 and 4; decision 0400).
--
-- The block in the page keeps only the button's ID (the editor node `actionButton`). A template
-- keeps its own copies of the buttons on its pages, and a page made from it gets new copies, so
-- changing one never changes another. A page copied with Duplicate still points at the first
-- page's button until it's opened; then it gets its own copy (copied_from, page_id).
-- workspace_id and page_id get their foreign keys in a later templates migration, once the
-- `workspaces` and `pages` tables are on main.

CREATE TABLE tpl_buttons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  -- The page it's on, or the template that keeps it.
  page_id uuid,
  template_id uuid REFERENCES tpl_templates (id) ON DELETE CASCADE,
  copied_from uuid REFERENCES tpl_buttons (id) ON DELETE SET NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  icon text CHECK (char_length(icon) <= 16),
  color text NOT NULL DEFAULT 'default' CHECK (
    color IN ('default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red')
  ),
  -- Who can press it: people who can edit the page, or everyone who can view it.
  who text NOT NULL DEFAULT 'editors' CHECK (who IN ('editors', 'viewers')),
  -- The steps in order (up to 10), as in @carehub/extras/templates/buttons.
  actions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(actions) = 'array'),
  -- Last set up by an Admin: only then may it message Everyone or roles (TB-14).
  set_by_admin boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tpl_buttons_owner_check CHECK ((page_id IS NULL) <> (template_id IS NULL))
);

CREATE INDEX tpl_buttons_page_idx ON tpl_buttons (page_id);
CREATE UNIQUE INDEX tpl_buttons_copy_idx ON tpl_buttons (copied_from, page_id)
  WHERE copied_from IS NOT NULL AND page_id IS NOT NULL;

-- Each button's last 50 runs: who, when, the result and the failed step, and what Undo reverses.
CREATE TABLE tpl_button_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  button_id uuid NOT NULL REFERENCES tpl_buttons (id) ON DELETE CASCADE,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  status text NOT NULL CHECK (
    status IN ('paused', 'done', 'failed', 'refused', 'cancelled', 'undone')
  ),
  -- Paused at a confirmation: the step Continue runs next.
  next_step integer CHECK (next_step BETWEEN 0 AND 10),
  -- 1-based, as in "Couldn't finish step 2".
  failed_step integer CHECK (failed_step BETWEEN 1 AND 10),
  reason text CHECK (char_length(reason) <= 500),
  -- Rows added, rows edited (values before and after) and messages sent, for Undo.
  changes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(changes) = 'array'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT tpl_button_runs_paused_check CHECK ((status = 'paused') = (next_step IS NOT NULL))
);

CREATE INDEX tpl_button_runs_button_idx ON tpl_button_runs (button_id, started_at DESC);
