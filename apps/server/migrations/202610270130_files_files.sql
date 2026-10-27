-- Files people upload (decision 0007, section 4.3). The bytes are on disk under FILES_DIR.

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- The feature that decides who may open the file (registerFileScope), and its own ID there.
  scope_feature text NOT NULL,
  scope_id text NOT NULL,
  uploaded_by uuid REFERENCES users (id) ON DELETE SET NULL,
  -- As the person named it, without folders or control characters.
  name text NOT NULL,
  -- Found from the file's contents, never from what the browser said.
  mime_type text NOT NULL,
  size bigint NOT NULL,
  -- Pictures only: pixels as shown.
  width integer,
  height integer,
  -- SHA-256 of the stored bytes, in hex. Also the ETag.
  sha256 text NOT NULL,
  -- The bytes are at FILES_DIR/<first 2>/<next 2>/<storage_key>. Copies of a file may share them.
  storage_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Deleted files stay on disk until the nightly clean-up (Data settings, section 3.1).
  deleted_at timestamptz,
  CONSTRAINT files_scope_feature_check CHECK (scope_feature ~ '^[a-z][a-z0-9-]{0,39}$'),
  CONSTRAINT files_scope_id_length CHECK (char_length(scope_id) BETWEEN 1 AND 200),
  CONSTRAINT files_name_length CHECK (char_length(name) BETWEEN 1 AND 255),
  CONSTRAINT files_size_check CHECK (size >= 0),
  CONSTRAINT files_dimensions_check CHECK ((width IS NULL AND height IS NULL) OR (width > 0 AND height > 0)),
  CONSTRAINT files_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX files_scope_idx ON files (scope_feature, scope_id) WHERE deleted_at IS NULL;
CREATE INDEX files_workspace_id_idx ON files (workspace_id);
CREATE INDEX files_uploaded_by_idx ON files (uploaded_by);
CREATE INDEX files_storage_key_idx ON files (storage_key);
