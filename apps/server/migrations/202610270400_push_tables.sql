-- Web push (Messages spec, "Unread and notifications"): the browsers that get each person's
-- notifications when Care Hub isn't open, and each person's notification settings.

-- One row per browser. The endpoint is the push service's address for that browser, so it
-- belongs to one person: whoever saved it last. Only https endpoints on the browsers' push
-- services are saved (push/domain/subscription.ts) and sent to (push/sender.ts).
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (endpoint LIKE 'https://%' AND length(endpoint) <= 1024),
  -- The browser's P-256 public key and auth secret, base64url (RFC 8291).
  p256dh text NOT NULL,
  auth text NOT NULL,
  -- How Settings → Notifications names it, such as "Chrome on Windows".
  device text NOT NULL,
  -- When the browser said the subscription ends, if it did.
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- When the browser last sent it, or a notification last reached it.
  last_used_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint)
);

-- A person's browsers: sending to them, and the list in Settings → Notifications.
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id, last_used_at DESC);

-- Each person's notification settings, the same in every workspace. No row means the defaults.
CREATE TABLE push_preferences (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- All messages; only direct messages, @mentions and notices; or nothing.
  notify_about text NOT NULL DEFAULT 'all' CHECK (notify_about IN ('all', 'mentions', 'nothing')),
  -- "Show message text in notifications".
  show_text boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
