-- Home settings: what each person changed about their Home (Home and reminders spec, section 4).
-- Only that person reads or changes them (HR-06). A person without a row has the defaults: every
-- section shown and the sidebar's Upcoming open. Chosen task databases come with My tasks.

CREATE TABLE home_settings (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- The sections hidden with Customize Home, by the IDs in features/home/types.ts.
  hidden_sections text[] NOT NULL DEFAULT '{}' CHECK (
    hidden_sections <@ ARRAY['upcoming', 'unread', 'tasks', 'reminders', 'learning', 'recent']
  ),
  upcoming_folded boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
