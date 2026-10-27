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
- `UnreadSection.tsx`: chats with unread messages, up to 5, with Open Messages beside the heading.
  The 🔔 Care Hub chat comes first while it has unread notices (HR-01), showing the latest
  notice's title and the unread count from `features/notices`. Each row shows the chat's name,
  the time of its latest message, its start and the unread count ('99+' over 99), and opens the
  chat. With none: "You're all caught up." It's live on `notices-changed`, and on
  `messages-changed` once Messages' hook is in.
- `RemindersSection.tsx`: the next 5 pending reminders, soonest first (snoozed ones included),
  with See all for `/reminders`. Each shows its page's or event's title, when it's due ('Today,
  3:00 PM', 'Tomorrow, 9:00 AM', 'Mon, Nov 2, 9:00 AM') and its note, and opens the page or the
  event in Calendar. One the person can't open says "A page you can't open" or "An event you
  can't open". With none: "No reminders. Use Remind me on a page or event." It's live on
  `reminders-changed`.
- `time.ts`: how Home says times, after the person's settings: `reminderDue` for reminders and
  `chatTime` for chats (the time today, Yesterday, the weekday this week, then the date).
- `settings.ts`: the person's Home settings from `GET /api/home/settings` (server:
  `features/home`), with `useHomeSettings` and `useChangeHomeSettings`. A change shows straight
  away and is undone if the server refuses it. Other tabs follow on `home-settings-changed`.
- `CustomizeHome.tsx`: the Customize Home menu beside the greeting. It has a checkbox for each
  section, it stays open between changes, and it's only for this person (HR-06). Home waits for
  the settings before drawing its sections, so a hidden one never flashes up. If the settings
  can't be loaded, every section shows and the menu stays off until they load.
- `SidebarUpcoming.tsx` and `slots.ts`: the sidebar's Upcoming under the top items. It shows the
  next 3 events of today and tomorrow, each opening in Calendar, with a Join icon when joinable
  and "Nothing else today" when there are none. Its heading folds, and the fold is kept in the
  person's settings. It uses the same request as Home's Upcoming.

## Stand-ins

- `upcoming.ts`: `UpcomingItem`, `isJoinable` and `useUpcoming(limit)` over Calendar's
  `GET /api/calendar/upcoming?limit=`. Switch to the ones from
  `@carehub/team-calendar-api` and `features/calendar` once they're on main.
- `viewer.ts`: no name and `DEFAULT_TIME_PREFS` until `useMe()` from `features/auth` lands
  (decision 0007, section 5.2).
- `unread.ts`: `UnreadChat` and `useUnreadChats(limit)`, as `features/messages` will export them.
  Until Messages is on main there are no chats, so only the 🔔 row can show. Switch to
  `import { useUnreadChats, type UnreadChat } from '../messages'` once it lands.
- `reminders.ts`: `PendingReminder` and `usePendingReminders(limit)` over `GET /api/reminders`,
  as `features/reminders` exports them on the web (#443). Until the server sends each
  reminder's title and link (#209), a reminder says "A page" or "An event" and opens the page or
  the event in Calendar. Switch to theirs once it's on main.

## Next

- The other sections, as their data lands: My tasks (task databases), My learning (hidden until
  Learning ships, Phase 4), and Recent pages.
- `/reminders` itself is the Reminders list from `features/reminders` (#444). See all opens it
  once that's on main.
