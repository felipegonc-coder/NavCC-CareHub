-- Notices: each person's 🔔 Care Hub chat, one per workspace (Messages spec MS-09; decision 0007,
-- section 4.4). Only IDs go in `card`: titles are looked up for the reader every time the chat
-- loads, so a notice never shows a title its reader can't open.
--
-- workspace_id and user_id get their foreign keys in a later notices migration, once the
-- `workspaces` and `users` tables are on main.

CREATE TABLE notices_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  -- Order in the chat: a grouped notice takes the next value again, which moves it to the end.
  position bigserial NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reminder', 'alert', 'mention', 'comment', 'automation')),
  sender text NOT NULL,
  actor_user_id uuid,
  icon text,
  title text NOT NULL,
  body text,
  -- {"type":"page","pageId":...} or {"type":"event","eventId":...,"occurrenceStart"?:...}
  card jsonb CHECK (card IS NULL OR jsonb_typeof(card) = 'object'),
  buttons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(buttons) = 'array'),
  group_key text,
  -- How many notices were grouped into this one.
  group_count integer NOT NULL DEFAULT 1 CHECK (group_count >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  latest_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

-- The chat, newest first, and its paging cursor.
CREATE INDEX notices_notices_chat_idx ON notices_notices (user_id, workspace_id, position DESC);

-- The unread count on the Messages badge.
CREATE INDEX notices_notices_unread_idx ON notices_notices (user_id, workspace_id)
  WHERE read_at IS NULL;

-- The latest notice with a group key, when grouping.
CREATE INDEX notices_notices_group_idx
  ON notices_notices (user_id, workspace_id, group_key, position DESC)
  WHERE group_key IS NOT NULL;
