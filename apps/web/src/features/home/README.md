# Home (web)

The start screen at `/` (Home and reminders spec, section 2): a greeting, then what needs
attention now.

## What's here

- `routes.tsx`: `/`, loaded lazily. Spread into `appRoutes` by `apps/web/src/routes.tsx`.
- `HomeScreen.tsx`: one `<main>` with the greeting as its `h1` ("Good afternoon, Avery · Monday,
  October 26", from `formatGreeting` in `@carehub/team-time`), then the sections in the spec's
  order: one column on phones and tablets, two from 1024 px wide, read left to right.
- `HomeSection.tsx`: the frame every section uses. It's a region named by its `h2`, with a link
  beside the heading (Open Calendar, See all). It has its own states: a skeleton after 300 ms,
  "Couldn't load …" with Retry, the empty text, and up to `limit` items, optionally under small
  headings (Today, Tomorrow). Rows are links, so Tab moves through them and Enter opens one.
  `SectionBoundary` keeps a section that breaks while drawing from taking the others down (HR-05).
- `sections.ts`: the sections in order. Every section gets the same `now` (`useNow`, which
  updates on each minute and when the tab comes back) and the person's time settings.
- `UpcomingSection.tsx`: the rest of today and tomorrow, up to 6, under Today and Tomorrow. Each
  shows its time ('Now' once started, 'All day'), its title ('(No title)' when empty) linking to
  Calendar, and Join from 10 minutes before the start until the end (HR-02, HR-17). It's live on
  `calendar.changed` and asks again when the day changes.

## Stand-ins

- `upcoming.ts`: `UpcomingItem`, `isJoinable` and `useUpcoming(limit)` over Calendar's
  `GET /api/calendar/upcoming?limit=` (W1-B). Switch to the ones from
  `@carehub/team-calendar-api` and `features/calendar` once they're on main.
- `viewer.ts`: no name and `DEFAULT_TIME_PREFS` until `useMe()` from `features/auth` lands
  (decision 0007, section 5.2).

## Next

- The other sections, as their data lands: Unread messages (Messages), My tasks (task
  databases), Reminders and its `/reminders` list (Reminders), My learning (hidden until Learning
  ships, Phase 4), and Recent pages.
- Customize Home (hide sections per person, HR-06) and the sidebar Upcoming.
