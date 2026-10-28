-- Review notices and Editing removes verification (Knowledge base spec, sections 3.1, 3.3 and 4):
-- each owner's last Monday summary for each knowledge base and which pages it listed, and when
-- each page was verified, to compare with its last edit.

ALTER TABLE kb_pages ADD COLUMN verified_at timestamptz;
-- Pages verified before this migration count as verified at their last index update.
UPDATE kb_pages SET verified_at = updated_at WHERE verification IS NOT NULL;
ALTER TABLE kb_pages ADD CONSTRAINT kb_pages_verified_at_check
  CHECK ((verification IS NULL) = (verified_at IS NULL));

CREATE TABLE kb_review_summaries (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  database_id uuid NOT NULL REFERENCES kb_bases (database_id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL,
  page_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(page_ids) <= 5000),
  PRIMARY KEY (user_id, database_id)
);
