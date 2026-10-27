-- Calendar connections (Calendar spec, Connections; CA-07, CA-10 to CA-12): outside calendars a
-- person shows in Care Hub, read-only. Secrets (a Google sign-in, a private link, an iCloud
-- app-specific password) are sealed with CALENDAR_SECRET_KEY and never leave the server.

CREATE TABLE cal_connections (
  -- Made by the server before it seals the secret: the id is the secret's associated data.
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Where its notices go (CA-12). Gets its foreign key once `workspaces` is on main.
  workspace_id uuid,
  kind text NOT NULL CHECK (kind IN ('google', 'google-bridge', 'icloud', 'link')),
  -- The person's name for it.
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  -- The account it reads, such as the Google address. Screens show it masked: a…@example.com.
  account text,
  secret text NOT NULL CHECK (secret LIKE 'v1.%'),
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'needs-reconnect', 'error')),
  -- A plain message for the layer. Never a secret or a link.
  last_error text,
  last_synced_at timestamptz,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  -- A sync run holds the connection until then, so two runs never read it at the same time.
  lease_until timestamptz,
  -- Failed runs in a row, for backing off.
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cal_connections_owner_idx ON cal_connections (owner_id);
CREATE INDEX cal_connections_due_idx ON cal_connections (next_sync_at);

-- The calendars a connection reads. A private link has one, with remote_id ''.
CREATE TABLE cal_connection_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES cal_connections (id) ON DELETE CASCADE,
  remote_id text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  -- A design kit colour name (`colorNames` in @carehub/ui).
  color text NOT NULL CHECK (
    color IN ('default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red')
  ),
  shown boolean NOT NULL DEFAULT true,
  time_zone text,
  -- Where the next sync starts: Google's sync token, or a link's ETag and Last-Modified.
  cursor jsonb CHECK (cursor IS NULL OR jsonb_typeof(cursor) = 'object'),
  last_full_sync_at timestamptz,
  -- More events in the window than Care Hub keeps (5,000): the rest aren't shown.
  truncated boolean NOT NULL DEFAULT false,
  CONSTRAINT cal_connection_calendars_remote_key UNIQUE (connection_id, remote_id)
);

-- Events as the outside calendar describes them. Read-only in Care Hub (CA-07).
CREATE TABLE cal_synced_events (
  calendar_id uuid NOT NULL REFERENCES cal_connection_calendars (id) ON DELETE CASCADE,
  -- Google's event id, or the uid and recurrence id of a link's event.
  remote_id text NOT NULL,
  uid text NOT NULL,
  -- The etag, or SEQUENCE and LAST-MODIFIED: it changes whenever the event does.
  version text,
  -- The ExternalEvent (sync/types.ts), people and their replies included.
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  -- The event's page in Google Calendar, for the panel's link (CA-17).
  html_link text,
  -- Rough UTC bounds for range reads, 14 hours wider than wall-clock times on each side. A null
  -- ends_at is a series without an end.
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (calendar_id, remote_id)
);

CREATE INDEX cal_synced_events_range_idx ON cal_synced_events (calendar_id, starts_at);
CREATE INDEX cal_synced_events_uid_idx ON cal_synced_events (calendar_id, uid);

-- Google sign-ins in progress: 10 minutes to come back from Google's screen.
CREATE TABLE cal_oauth_states (
  -- SHA-256 (hex) of the state sent to Google. The state itself is only ever in the URL.
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid,
  -- The PKCE code verifier, sealed.
  code_verifier text NOT NULL CHECK (code_verifier LIKE 'v1.%'),
  -- Set when this sign-in reconnects an existing connection.
  connection_id uuid REFERENCES cal_connections (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX cal_oauth_states_expires_idx ON cal_oauth_states (expires_at);
