-- Notices, part 2: the kinds other features send, foreign keys now that `users` and `workspaces`
-- are on main, and idempotency keys so a retried send adds nothing.

ALTER TABLE notices_notices DROP CONSTRAINT notices_notices_kind_check;

ALTER TABLE notices_notices ADD CONSTRAINT notices_notices_kind_check CHECK (kind IN (
  'reminder', 'alert', 'mention', 'comment', 'automation', 'reply', 'suggestion',
  'suggestion_accepted', 'suggestion_rejected', 'edit_summary', 'shared', 'access_request',
  'import', 'export'
));

-- A person's notices go when their account or the workspace does. A notice keeps its sender's
-- name when the person behind it is deleted.
ALTER TABLE notices_notices
  ADD CONSTRAINT notices_notices_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  ADD CONSTRAINT notices_notices_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  ADD CONSTRAINT notices_notices_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL;

-- For ON DELETE SET NULL when a person is deleted.
CREATE INDEX notices_notices_actor_idx ON notices_notices (actor_user_id)
  WHERE actor_user_id IS NOT NULL;

-- One row per idempotency key a person's notices were sent with (SendNoticeInput.idempotencyKey).
-- A key lasts as long as its notice.
CREATE TABLE notices_idempotency_keys (
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
  notice_id uuid NOT NULL REFERENCES notices_notices (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id, key)
);

CREATE INDEX notices_idempotency_keys_notice_idx ON notices_idempotency_keys (notice_id);
