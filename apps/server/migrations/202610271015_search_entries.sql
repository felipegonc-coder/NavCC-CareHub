-- Search index (Search spec, section 4): one entry per page, database and row, rebuilt from the
-- page model and page content. Access is never copied in here: every search checks it again.
-- Text is folded (lowercase, no accents) by the server before it gets here. In doc_tsv the title
-- has weight A and headings weight B, so title and heading matches rank first.
CREATE TABLE search_entries (
  page_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  space_id uuid,
  parent_id uuid,
  -- Parent pages, top first: "In" filters and paths.
  ancestor_ids uuid[] NOT NULL DEFAULT '{}',
  kind text NOT NULL CHECK (kind IN ('page', 'database', 'row')),
  title text NOT NULL DEFAULT '',
  -- Folded title with punctuation as spaces, for exact and "starts with" matches.
  title_key text NOT NULL DEFAULT '',
  icon jsonb,
  -- Block text, one block per line, and text other features add (row properties).
  body text NOT NULL DEFAULT '',
  extra text NOT NULL DEFAULT '',
  doc_tsv tsvector NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz,
  trashed_at timestamptz,
  -- page_docs.text_updated_at when the body was read.
  text_seen_at timestamptz,
  indexed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX search_entries_doc_idx ON search_entries USING gin (doc_tsv);
CREATE INDEX search_entries_ancestors_idx ON search_entries USING gin (ancestor_ids);
CREATE INDEX search_entries_workspace_idx ON search_entries (workspace_id, updated_at DESC);
CREATE INDEX search_entries_text_seen_idx ON search_entries (text_seen_at);
