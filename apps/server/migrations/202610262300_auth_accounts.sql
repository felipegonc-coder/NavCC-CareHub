-- Accounts and sign-in: people and their sessions.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  avatar_url text,
  -- Argon2id. Null until the person sets a password (for example from an invite or setup link).
  password_hash text,
  must_change_password boolean NOT NULL DEFAULT false,
  -- Manages accounts and the server. Gives no permission inside a workspace by itself.
  is_site_admin boolean NOT NULL DEFAULT false,
  job_title text,
  time_zone text NOT NULL DEFAULT 'America/Denver',
  use_24h boolean NOT NULL DEFAULT false,
  -- 0 = Sunday … 6 = Saturday.
  week_start smallint NOT NULL DEFAULT 0,
  -- Wrong passwords since failed_sign_ins_since; 10 within 15 minutes pause sign-in until sign_in_paused_until.
  failed_sign_ins integer NOT NULL DEFAULT 0,
  failed_sign_ins_since timestamptz,
  sign_in_paused_until timestamptz,
  -- Locked by a site admin: can't sign in, and existing sessions stop working.
  locked_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_email_lower_case CHECK (email = lower(email)),
  CONSTRAINT users_week_start_check CHECK (week_start BETWEEN 0 AND 6),
  CONSTRAINT users_failed_sign_ins_check CHECK (failed_sign_ins >= 0)
);

-- Only a SHA-256 hash (hex) of each 32-byte random token is stored; the token itself is only in the cookie.
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text,
  -- The device's (Tailscale) address when it signed in.
  ip_address text,
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sessions_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
