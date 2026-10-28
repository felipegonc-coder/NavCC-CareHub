-- Claude usage (docs/extras/claude.md, "Usage log"): a request counts from before it's sent.
-- askClaude reserves a 'pending' row under the workspace's and the person's advisory locks, then
-- writes how the request ended over it, so requests that arrive together can't all pass the caps.

ALTER TABLE claude_usage DROP CONSTRAINT claude_usage_status_check;
ALTER TABLE claude_usage ADD CONSTRAINT claude_usage_status_check CHECK (status IN ('pending', 'ok',
  'not_set_up', 'not_approved', 'switched_off', 'no_permission', 'monthly_cap', 'user_rate_limit',
  'too_long', 'unavailable', 'bad_output'));
