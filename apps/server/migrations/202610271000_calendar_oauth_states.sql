-- Google sign-ins in progress: 10 minutes to come back from Google's screen.
CREATE TABLE cal_oauth_states (
  -- SHA-256 (hex) of the state sent to Google. The state itself is only ever in the URL.
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 (hex) naming the signed-in session that started it, never the session token itself.
  -- The callback only finishes in that same session.
  session_key text NOT NULL CHECK (session_key ~ '^[0-9a-f]{64}$'),
  workspace_id uuid,
  -- The PKCE code verifier, sealed.
  code_verifier text NOT NULL CHECK (code_verifier LIKE 'v1.%'),
  -- Set when this sign-in reconnects an existing connection.
  connection_id uuid REFERENCES cal_connections (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX cal_oauth_states_expires_idx ON cal_oauth_states (expires_at);
