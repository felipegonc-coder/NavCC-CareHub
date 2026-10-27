# Home (server)

What Home keeps on the server (Home and reminders spec, section 4). Home's sections get their
items from the features that own them (Calendar, Messages, Reminders and the rest); this feature
keeps only each person's Home settings.

## Routes

At `/api/home`, signed in only. Both answer `{ settings }`, the signed-in person's own:

- `GET /settings`: `{ hiddenSections, upcomingFolded }`. Until the person changes something,
  `{ hiddenSections: [], upcomingFolded: false }`: every section shown and the sidebar's
  Upcoming open.
- `PATCH /settings`: `hiddenSections` (section IDs), `upcomingFolded`, or both; the other setting
  stays as it is. An unknown section, an unknown field or an empty change is refused with 400
  `invalid` and a message saying what's wrong.

Neither route takes a person, so everyone reads and changes only their own settings, and hiding a
section hides it for no one else (HR-06). After a change, the person's open tabs get the live
event `home-settings-changed` and ask again.

## Files

- `types.ts`: `HOME_SECTION_IDS` (upcoming, unread, tasks, reminders, learning, recent, in Home's
  order), `HomeSettings`, and `homeSettingsChangeSchema` for the PATCH body. Hidden sections are
  kept once each, in Home's order.
- `schema.ts` and the migration `202610270830_home_settings.sql`: `home_settings`, one row for
  each person who changed something, deleted with the person.
- `store.ts`: `readHomeSettings` and `changeHomeSettings`, one upsert, so two tabs changing
  settings at once can't add two rows.
- `routes.ts`: the routes above, registered on the `// feature: home` line of `app.ts`.

## Next

- Chosen task databases for My tasks (spec v2), in their own table.
