-- Recent searches, opened pages and counted search terms (Search spec, sections 3.4 and 4).

-- Each person's last searches per workspace; the last 5 are kept.
CREATE TABLE search_recent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  text text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}',
  searched_at timestamptz NOT NULL DEFAULT now()
);
-- Searching the same text again moves it to the top.
CREATE UNIQUE INDEX search_recent_text_idx ON search_recent (user_id, workspace_id, lower(text));
CREATE INDEX search_recent_list_idx ON search_recent (user_id, workspace_id, searched_at DESC);

-- When each person last opened each page: Recent before typing, and ranking (opened in 30 days).
CREATE TABLE search_visits (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  page_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_id)
);
CREATE INDEX search_visits_list_idx ON search_visits (user_id, workspace_id, opened_at DESC);

-- Counted search terms for Analytics, without who searched.
CREATE TABLE search_terms (
  workspace_id uuid NOT NULL,
  day date NOT NULL,
  term text NOT NULL CHECK (char_length(term) BETWEEN 1 AND 100),
  searches integer NOT NULL DEFAULT 0,
  people integer NOT NULL DEFAULT 0,
  no_results integer NOT NULL DEFAULT 0,
  opened integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, day, term)
);

-- Counting people once per day needs to recognise a repeat: a keyed hash of (person, term) with a
-- key for that day only. Keys and hashes are deleted the day after, so nobody can be traced later.
CREATE TABLE search_term_keys (
  day date PRIMARY KEY,
  key bytea NOT NULL
);
CREATE TABLE search_term_people (
  day date NOT NULL,
  person_hash bytea NOT NULL,
  PRIMARY KEY (day, person_hash)
);
