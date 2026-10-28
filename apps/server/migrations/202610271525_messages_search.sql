-- Message search (Messages spec 3, MS-19 to MS-21). `search` holds a message's words as
-- @carehub/team-chat's searchVector writes them (the text as people read it, mentions as names),
-- so the server and the browser match words the same way; it's empty for system lines and
-- deleted messages. `has` is what the Has filter looks for: picture, file, link or pageCard.
-- Messages saved before this migration have an empty index until they're edited.
ALTER TABLE msg_messages ADD COLUMN search tsvector NOT NULL DEFAULT ''::tsvector;
ALTER TABLE msg_messages ADD COLUMN has text[] NOT NULL DEFAULT '{}';

CREATE INDEX msg_messages_search_idx ON msg_messages USING GIN (search);
