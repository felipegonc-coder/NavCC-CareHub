-- Each person's recent mentions in page text, for the limits on how many of them notify (issue
-- #224): 20 a minute, and the same person 30 an hour. Past them a mention is saved `quiet`.

CREATE INDEX mentions_sender_idx ON mentions (mentioned_by, created_at DESC)
  WHERE block_id IS NOT NULL;
