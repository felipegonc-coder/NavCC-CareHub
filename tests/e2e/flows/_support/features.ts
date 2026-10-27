import { test } from './test.js';

/**
 * What a person can reach on `main`, one feature per line. Set a line to true in the pull request
 * whose tests match that feature on `main`; that pull request's browser tests run before it merges.
 * Until then, tests that call `needs()` for it are reported as "Not built yet" (Playwright `fixme`).
 */
export const onMain = {
  /** The design kit gallery at /design: tokens, theme switch and base components (#2). */
  designKit: true,

  /** Menus, dialogs, popovers, tooltips, toasts and 44 px touch targets on phones (#27). */
  overlays: true,

  /** The app shell: sidebar from the slots, phone menu, top bar and Not found (#34). */
  appShell: true,

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

  /** Live updates and jobs in app.ts (#288): others' changes show without a reload. */
  liveUpdates: true,

  /** Sharing: the share dialog, access levels, guests and share links. */
  sharing: false,

  /** Comments, replies and @ mentions of people, pages and dates. */
  comments: false,

  /** Suggested edits: Suggesting mode, the marks by their author, Accept and Reject (all). */
  suggestedEdits: false,

  /** Following a page (a notice for each new comment) and muting a thread. */
  following: false,

  /** The 🔔 Care Hub chat where notices arrive. */
  notices: false,

  /** Reply in a comment notice: the answer goes into the thread without leaving the 🔔 chat. */
  noticeReply: false,

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

  /** Settings → Site → Accounts (site admins): a person's workspaces and Make Admin. */
  siteAccounts: false,

  /** Groups: in Settings → Members, in the share dialog and for assigning courses. */
  groups: false,

  /** Database screens: table view, properties, rows as pages. */
  databases: false,

  /** Formulas: the formula property, its editor, results and errors. */
  formulas: false,

  /** CSV import and export screens of a database. */
  databaseCsv: false,

  /** The other database views: board, calendar, gallery, list, timeline and chart. */
  databaseViews: false,

  /** Form screens: build a form, fill it in, answers arrive as rows. */
  forms: false,

  /** Forms anyone with the link can fill in without signing in, file uploads included. */
  publicForms: false,

  /** Messages: direct and group chats, unread counts. */
  messages: false,

  /** Home: the start screen after signing in, with its sections. */
  home: false,

  /** Reminders: "Remind me" on pages, events and dates, and the Reminders list. */
  reminders: false,

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

  /** Knowledge base: turn a page into one, owners, verification, Draft and Published, reports. */
  knowledgeBase: false,

  /** Data settings: Settings → Data (keeping data, storage, uploads) and Export my content. */
  dataSettings: false,

  /** Learning for learners: My learning, the Catalog, start pages and the player (#250, #245). */
  learning: false,

  /** Learning Studio: the course editor, Preview and Publish (after #250). */
  learningStudio: false,

  /** Learning quizzes in the player: questions, Submit, the score, Try again. */
  learningQuizzes: false,

  /** Learning: assign courses, due dates and tracking. */
  learningAssign: false,

  /** Learning reports: course reports, Download CSV, Reset and transcripts. */
  learningReports: false,

  /** Learning review links: the read-only screen for a shared draft (#231). */
  learningReview: false,

  /** Learning's e2e test hooks (#247), with CAREHUB_TEST_HOOKS=1 in the e2e server's env. */
  learningTestHooks: false,

  /** Learning: certificates. */
  certificates: false,

  /** Claude features: Settings → Claude, writing help, assistant, Claude fields, meeting summary. */
  claude: false,
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
