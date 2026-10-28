-- How far each Date arrives automation's dates have been checked (Automations spec, section 3):
-- every arrival up to checked_until has been queued, so after a restart the check carries on from
-- there (AU-05). Switching the automation off forgets its row.
CREATE TABLE automations_date_checks (
  automation_id uuid PRIMARY KEY REFERENCES automations_automations (id) ON DELETE CASCADE,
  checked_until timestamptz NOT NULL
);
