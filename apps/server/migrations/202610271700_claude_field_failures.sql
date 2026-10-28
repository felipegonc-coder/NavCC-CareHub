-- Claude fields' background fills, continued (docs/extras/claude.md, "Claude fields"). Holds no
-- text from a row or from Claude.
--
-- claude_usage.background: a fill nobody is waiting for (By hand for more than one row, or
-- Automatically). It counts toward the monthly cap and each database's hourly cap, but not toward
-- the person's 30 requests in 10 minutes.
--
-- claude_field_queue.batch_id: the By-hand Fill a row is part of; null for automatic fills, which
-- are one batch for each field. failed_reason: why the row couldn't fill. The row stays until the
-- rest of its batch is done, then one notice tells whoever asked (for automatic fills, the owner).

ALTER TABLE claude_usage ADD COLUMN background boolean NOT NULL DEFAULT false;

ALTER TABLE claude_field_queue ADD COLUMN batch_id uuid;
ALTER TABLE claude_field_queue ADD COLUMN failed_reason text;
