-- Uploads to scopes open to people who aren't signed in (forms anyone can fill in, decision 0010) wait
-- until what they were uploaded for claims them (claimFiles); the hourly clean-up deletes those still
-- unclaimed at their deadline, about an hour after upload.
ALTER TABLE files ADD COLUMN claim_deadline timestamptz;

CREATE INDEX files_claim_deadline_idx ON files (claim_deadline)
  WHERE claim_deadline IS NOT NULL AND deleted_at IS NULL;
-- For the daily byte quota of each scope.
CREATE INDEX files_scope_created_at_idx ON files (scope_feature, scope_id, created_at);
