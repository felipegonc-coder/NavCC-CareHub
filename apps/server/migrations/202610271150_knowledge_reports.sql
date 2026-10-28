-- Report a problem (Knowledge base spec, section 3.4): reports on knowledge base pages and their
-- replies. Private: only the reporter, the page's owners and the knowledge base's editors see
-- them. Closed reports stay as long as the page; turning the knowledge base back removes them.
--
-- page_id and workspace_id get their foreign keys in a later knowledge migration, once the
-- `pages` and `workspaces` tables are on main (page_id with ON DELETE CASCADE).

CREATE TABLE kb_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL,
  database_id uuid NOT NULL REFERENCES kb_bases (database_id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  reporter_id uuid NOT NULL REFERENCES users (id),
  reason text NOT NULL
    CHECK (reason IN ('out_of_date', 'wrong_or_unclear', 'broken_link', 'missing', 'other')),
  -- Required for Other.
  text text NOT NULL DEFAULT '' CHECK (char_length(text) <= 2000),
  -- The text that was selected, and its block.
  quote text CHECK (char_length(quote) BETWEEN 1 AND 500),
  block_id text CHECK (block_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'fixed', 'wont_fix')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES users (id),
  closed_at timestamptz,
  CONSTRAINT kb_reports_other_check CHECK (reason <> 'other' OR text <> ''),
  CONSTRAINT kb_reports_closed_check CHECK (
    (status IN ('fixed', 'wont_fix')) = (closed_at IS NOT NULL)
    AND (closed_at IS NULL) = (closed_by IS NULL)
  )
);

-- A page's reports (the strip's count), a knowledge base's (the Reports view) and a reporter's
-- own on a page ("Your reports", and reporting again within 7 days).
CREATE INDEX kb_reports_page_idx ON kb_reports (page_id, created_at DESC);
CREATE INDEX kb_reports_database_idx ON kb_reports (database_id, created_at DESC);
CREATE INDEX kb_reports_reporter_idx ON kb_reports (reporter_id, page_id, created_at DESC);

CREATE TABLE kb_report_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES kb_reports (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users (id),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX kb_report_replies_report_idx ON kb_report_replies (report_id, created_at);
