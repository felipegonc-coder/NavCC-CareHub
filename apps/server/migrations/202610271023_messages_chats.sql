-- Messages (Team tools): direct chats, groups, their members and their messages (Messages spec,
-- section 4). The 🔔 Care Hub chat belongs to the notices feature. Pictures, files, reactions and
-- the search index come in later messages migrations.

CREATE TABLE msg_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('direct', 'group')),
  -- Groups only; without one, the members' names show.
  name text CHECK (char_length(name) <= 100),
  -- Direct chats: both people's IDs in order (directChatKey), so a pair has only one chat.
  direct_key text,
  -- Groups: the current members' IDs in order (membersKey), for "Open existing chat".
  members_key text,
  started_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The latest message's seq (0 before the first) and time. Sending locks this row, so the
  -- messages of a chat get 1, 2, 3, … in the order they're sent.
  last_seq integer NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msg_chats_shape_check CHECK (
    (type = 'direct' AND direct_key IS NOT NULL AND members_key IS NULL AND name IS NULL)
    OR (type = 'group' AND direct_key IS NULL AND members_key IS NOT NULL)
  )
);

CREATE UNIQUE INDEX msg_chats_direct_key ON msg_chats (workspace_id, direct_key);
CREATE INDEX msg_chats_members_key ON msg_chats (workspace_id, members_key);

CREATE TABLE msg_members (
  chat_id uuid NOT NULL REFERENCES msg_chats (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  -- The person who started the group, or who took over from them.
  can_remove_others boolean NOT NULL DEFAULT false,
  -- The seq of the last message the person has read (0: none).
  last_read_seq integer NOT NULL DEFAULT 0,
  muted boolean NOT NULL DEFAULT false,
  -- Left the group or was removed from it: the chat is gone for them.
  left_at timestamptz,
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX msg_members_user_idx ON msg_members (user_id) WHERE left_at IS NULL;

CREATE TABLE msg_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES msg_chats (id) ON DELETE CASCADE,
  seq integer NOT NULL,
  -- A person's message, or a small line about a change ("Avery Lin added Sam Ortiz").
  kind text NOT NULL CHECK (kind IN ('message', 'system')),
  sender_id uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Made in the sender's browser, so a resend after a dropped connection is the same message.
  client_id uuid,
  -- With <@userId> mentions. '' when the message is only page cards, and once it's deleted.
  text text NOT NULL DEFAULT '' CHECK (char_length(text) <= 4000),
  -- People in the chat it mentions, and its page cards in order.
  mentions uuid[] NOT NULL DEFAULT '{}',
  page_ids text[] NOT NULL DEFAULT '{}',
  -- System lines: what changed, shown with current names (systemEventSchema).
  system jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT msg_messages_seq_key UNIQUE (chat_id, seq),
  CONSTRAINT msg_messages_client_key UNIQUE (sender_id, client_id),
  CONSTRAINT msg_messages_shape_check CHECK (
    (kind = 'message' AND client_id IS NOT NULL AND system IS NULL)
    OR (kind = 'system' AND client_id IS NULL AND sender_id IS NULL AND system IS NOT NULL)
  )
);
