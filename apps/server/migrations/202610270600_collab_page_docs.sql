-- Live co-editing: each page's Y.Doc, plus the Markdown and plain-text copies that export,
-- imports and search read (decision 0007, section 4.2).
create table page_docs (
  page_id uuid primary key references pages (id) on delete cascade,
  ydoc bytea not null,
  markdown text not null default '',
  text text not null default '',
  block_count integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id) on delete set null
);
