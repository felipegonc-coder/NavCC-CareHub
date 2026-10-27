-- Knowledge bases on wiki databases (Knowledge base spec, sections 3 and 4): each knowledge base's
-- settings, and an index of its pages' status, owners and verification.
--
-- The page's values live in the wiki database's built-in properties (Owner, Status, Verification,
-- Tags); `kb_pages` repeats what the reminders and owner changes look up, and is written in the
-- same transaction. database_id, page_id and workspace_id get their foreign keys in a later
-- knowledge migration, once the `pages` and `workspaces` tables are on main.

CREATE TABLE kb_bases (
  database_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  -- The verify period the review bar uses: 1 week, 30 days, 90 days, 6 months, 1 year or no end.
  default_period text NOT NULL DEFAULT '90d'
    CHECK (default_period IN ('1w', '30d', '90d', '6m', '1y', 'none')),
  -- When on, any edit to a verified page makes it Not verified and tells its owners.
  editing_removes_verification boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id)
);

CREATE TABLE kb_pages (
  page_id uuid PRIMARY KEY,
  database_id uuid NOT NULL REFERENCES kb_bases (database_id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  -- When it was published and by whom (null for the knowledge base's own writes); cleared by
  -- Back to draft.
  published_by uuid REFERENCES users (id),
  published_at timestamptz,
  -- In order: the first owner's time zone sets when the page expires. Empty means No owner.
  owners uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(owners) <= 5),
  -- Null is Not verified. verified_until null is "no end date".
  verification text CHECK (verification IN ('verified', 'expired')),
  verified_until date,
  expired_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_pages_published_check CHECK (
    (status = 'published') = (published_at IS NOT NULL)
    AND (published_by IS NULL OR published_at IS NOT NULL)
  ),
  CONSTRAINT kb_pages_verification_check CHECK (
    (verification IS NULL AND verified_until IS NULL AND expired_at IS NULL)
    OR (verification = 'verified' AND expired_at IS NULL)
    OR (verification = 'expired' AND verified_until IS NOT NULL AND expired_at IS NOT NULL)
  )
);

CREATE INDEX kb_pages_database_idx ON kb_pages (database_id);
-- "Riley Chen no longer owns 12 pages": an owner's pages.
CREATE INDEX kb_pages_owners_idx ON kb_pages USING gin (owners);
-- Pages that expire next.
CREATE INDEX kb_pages_until_idx ON kb_pages (verified_until) WHERE verification = 'verified';
