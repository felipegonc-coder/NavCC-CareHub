-- Assistant chats (Claude features spec, sections 3.3 and 4; CL-11, CL-D3). Only their owner can
-- list or open them, Admins included; nothing else reads these tables. A chat is kept until its owner
-- deletes it (with its messages) or the account is removed, unless an Admin chose 30, 90 or 365 days
-- in Settings → Claude (claude.chatRetentionDays), counted from its last question.
--
-- workspace_id gets its foreign key in a later Claude migration, once `workspaces` is on main.

CREATE TABLE claude_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  questions integer NOT NULL DEFAULT 0 CHECK (questions BETWEEN 0 AND 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX claude_chats_owner_idx ON claude_chats (owner_id, workspace_id, updated_at DESC);
CREATE INDEX claude_chats_workspace_idx ON claude_chats (workspace_id, updated_at);

-- One question and its answer share a turn (1 to 50). A question keeps its chip (`scope`) and what
-- Claude could read (`pages`); an answer keeps its `sources`. Both as [{ "id", "title" }].
CREATE TABLE claude_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES claude_chats (id) ON DELETE CASCADE,
  turn integer NOT NULL CHECK (turn BETWEEN 1 AND 50),
  role text NOT NULL CHECK (role IN ('question', 'answer')),
  text text NOT NULL CHECK (char_length(text) >= 1),
  scope text CHECK (scope IN ('this_page', 'all_pages', 'no_pages')),
  pages jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(pages) = 'array'),
  sources jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, turn, role),
  CONSTRAINT claude_messages_scope_check CHECK ((role = 'question') = (scope IS NOT NULL))
);
