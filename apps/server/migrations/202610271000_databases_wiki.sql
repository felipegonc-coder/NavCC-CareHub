-- Knowledge base wikis (decision 0200): a database can be a wiki. The row resolver applies the
-- Knowledge base's Draft rule to the rows of databases with this flag. Only Full access turns it
-- on or off (PATCH /api/databases/:id), and Lock structure doesn't stop that.
ALTER TABLE db_databases ADD COLUMN wiki boolean NOT NULL DEFAULT false;
