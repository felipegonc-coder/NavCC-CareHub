import { test } from './test.js';

/**
 * What a person can reach on `main`, one feature per line. Set a line to true in the pull request
 * whose tests match that feature on `main` (the Testing lead runs its browser tests before merging).
 * Until then, tests that call `needs()` for it are reported as "Not built yet" (Playwright `fixme`).
 */
export const onMain = {
  /** The design kit gallery at /design: tokens, theme switch and base components (#2). */
  designKit: true,

  /** Menus, dialogs, popovers, tooltips, toasts and 44 px touch targets on phones (#27). */
  overlays: false,

  /** The app shell: sidebar from the slots, phone menu, top bar and Not found (#34). */
  appShell: false,

  /** The sign-in screens, the seeded people and signInAs in tests/e2e/helpers/auth.ts. */
  signIn: false,

  /** Spaces, the sidebar page tree, New page and the page view (title, icon, cover). */
  pages: false,

  /** The block editor inside the page view: blocks, Markdown shortcuts, links. */
  editor: false,

  /** The "/" menu and the block menu (turn into, duplicate, delete, color). */
  slashMenu: false,

  /** Live co-editing: two people in one page, names and cursors. */
  coEditing: false,

  /** Sharing: the share dialog, access levels, guests and share links. */
  sharing: false,

  /** Comments, replies and @ mentions of people, pages and dates. */
  comments: false,

  /** The 🔔 Care Hub chat where notices arrive. */
  notices: false,

  /** Search from the search box and Ctrl/Cmd + K. */
  search: false,

  /** Trash and page history. */
  trashHistory: false,

  /** Templates and buttons. */
  templates: false,

  /** Import and export of pages (Markdown, Notion export, PDF). */
  importExport: false,

  /** Settings and members: profile, members, roles. */
  settings: false,

  /** Database screens: table view, properties, rows as pages. */
  databases: false,

  /** CSV import and export screens of a database. */
  databaseCsv: false,

  /** The other database views: board, calendar, gallery, list, timeline and chart. */
  databaseViews: false,

  /** Form screens: build a form, fill it in, answers arrive as rows. */
  forms: false,

  /** Messages: direct and group chats, unread counts. */
  messages: false,

  /** Home and reminders ("Remind me"). */
  home: false,

  /** The Calendar screens: day, week and month, events and layers. */
  calendar: false,

  /** Meetings: meeting notes from events. */
  meetings: false,

  /** Automations: triggers, actions and "Try it now". */
  automations: false,

  /** Analytics (Admins only). */
  analytics: false,

  /** The public status page at /status. */
  statusPage: false,

  /** Learning: Studio, the course player and My learning. */
  learning: false,

  /** Learning: assign courses, due dates and tracking. */
  learningAssign: false,

  /** Learning: certificates. */
  certificates: false,
} as const satisfies Record<string, boolean>;

export type Feature = keyof typeof onMain;

/**
 * Marks the tests of the current file or `test.describe` block "Not built yet" until every named
 * feature is on main. Call it next to `onlyIn()`, at the top of the block.
 *
 *   needs('signIn', 'pages', 'comments');
 */
export function needs(...features: [Feature, ...Feature[]]): void {
  const missing = features.filter((feature) => !onMain[feature]);
  test.fixme(missing.length > 0, `Not built yet: ${missing.join(', ')}`);
}
