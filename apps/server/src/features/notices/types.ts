// The notices contract (decision 0007, section 4.4). Other lanes code against these names: keep
// them exactly as they are and only ever add optional fields.

/**
 * What kind of notice it is. Each kind has its own default icon in the chat, and the kind decides
 * which filter chip shows it (domain/filters.ts):
 * - `reminder`: a reminder is due.
 * - `alert`: something needs the person's attention, such as a sign-in from a new device.
 * - `mention`: someone mentioned the person in a page or comment.
 * - `comment`: a new comment on a page the person follows.
 * - `automation`: an automation ran, or failed.
 * - `reply`: a reply in a comment thread the person is in.
 * - `suggestion`: a suggested edit on a page the person follows.
 * - `suggestion_accepted`, `suggestion_rejected`: what happened to the person's suggestion.
 * - `edit_summary`: a summary of recent edits to a page the person follows.
 * - `shared`: a page was shared with the person.
 * - `access_request`: someone asked for access to a page the person can share.
 * - `import`, `export`: an import or export the person started has finished, or failed.
 */
export const NOTICE_KINDS = [
  'reminder',
  'alert',
  'mention',
  'comment',
  'automation',
  'reply',
  'suggestion',
  'suggestion_accepted',
  'suggestion_rejected',
  'edit_summary',
  'shared',
  'access_request',
  'import',
  'export',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * A card under the notice. Only IDs are stored: the title, icon and space are looked up for the
 * reader every time the chat loads, and a reader who can't open the page or event sees a locked
 * card without them.
 */
export type NoticeCard =
  | { type: 'page'; pageId: string }
  | {
      type: 'event';
      eventId: string;
      /** One occurrence of a repeating event: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm` or an ISO instant. */
      occurrenceStart?: string;
    };

/** A button that opens a Care Hub path, such as `/p/<pageId>`. Relative paths only. */
export interface NoticeLinkButton {
  label: string;
  href: string;
}

/** One entry in an action button's menu, such as Snooze → "1 hour". */
export interface NoticeActionChoice {
  label: string;
  value: string;
}

/**
 * A button that runs the server handler registered with `registerNoticeAction(action, handler)`,
 * such as a reminder's Done. With `choices` it opens a menu, and the handler gets the picked
 * choice's value. The action and value always come from the stored notice, never the browser.
 */
export interface NoticeActionButton {
  label: string;
  /** `<feature>.<name>`, such as `reminders.snooze`. */
  action: string;
  value?: string;
  /** 1 to 5 choices. A button with choices has no `value` of its own. */
  choices?: readonly NoticeActionChoice[];
}

export type NoticeButton = NoticeLinkButton | NoticeActionButton;

export interface SendNoticeInput {
  workspaceId: string;
  /** Whose 🔔 Care Hub chat it lands in. Each person has one per workspace; only they can read it. */
  userId: string;
  kind: NoticeKind;
  /** Shown as given: 'Learning', 'Databases', 'Forms', an automation's name, or a person's name. */
  sender: string;
  /** The person behind a mention or comment (with their name as `sender`). */
  actorUserId?: string;
  /** An emoji, such as '⏰'. Without one, the chat shows the kind's icon. */
  icon?: string;
  /** Generic and shown as given. Never a page or event title: only cards carry titles. */
  title: string;
  text?: string;
  card?: NoticeCard;
  /** At most 3. */
  buttons?: readonly NoticeButton[];
  /**
   * If this person got a notice with the same key in this workspace within the last 5 minutes,
   * that notice is updated in place (new content, unread again, moved to latest, count + 1).
   */
  groupKey?: string;
  /**
   * Makes retries safe: when this person already got a notice with this key in this workspace,
   * nothing is added and the result has that notice's ID with `duplicate: true`. A key lasts as
   * long as its notice. For example `reminders:<reminderId>:<dueAt>`.
   */
  idempotencyKey?: string;
}

export interface SendNoticeResult {
  /** The notice's ID; empty when it was dropped. */
  noticeId: string;
  /** True when a recent notice with the same group key was updated instead of adding one. */
  grouped: boolean;
  /** Set when a notice with the same idempotency key was already sent: nothing changed. */
  duplicate?: true;
  /** Set when the person isn't in the workspace (any more): nothing was saved. */
  dropped?: true;
}

export type SendNotice = (input: SendNoticeInput) => Promise<SendNoticeResult>;

/** The `app.events` name emitted after the commit for every notice sent, grouped ones included. */
export const NOTICE_CREATED_EVENT = 'notices.notice.created';

export interface NoticeCreatedEvent {
  workspaceId: string;
  userId: string;
  noticeId: string;
  kind: NoticeKind;
  grouped: boolean;
}

/** The live event type published to a person whenever their notices change. */
export const NOTICES_CHANGED_EVENT = 'notices-changed';

/** What an action handler receives when the notice's owner clicks one of its action buttons. */
export interface NoticeActionContext {
  noticeId: string;
  workspaceId: string;
  /** The notice's owner: the only person who can click its buttons. */
  userId: string;
  action: string;
  /** The button's `value`, or the picked choice's; null when neither is set. */
  value: string | null;
}

export interface NoticeActionResult {
  /** A short confirmation shown to the person, such as "Snoozed for 1 hour". */
  message?: string;
}

export type NoticeActionHandler = (
  context: NoticeActionContext,
) => Promise<NoticeActionResult | void>;

// What the chat is sent (GET /api/notices). Titles appear only on open cards.

/** A page icon, as the page model stores it (decision 0007, section 4.1). */
export type PageIcon =
  { type: 'emoji'; emoji: string } | { type: 'icon'; name: string; color?: string | null };

export type NoticeCardView =
  | {
      type: 'page';
      state: 'open';
      pageId: string;
      href: string;
      title: string;
      icon: PageIcon | null;
      spaceName: string | null;
    }
  | {
      type: 'event';
      state: 'open';
      eventId: string;
      occurrenceStart: string | null;
      href: string;
      title: string;
      /** When it happens, worded by Calendar for this reader, such as "Tue, Oct 28 · 3:00 PM". */
      when: string | null;
    }
  /** "🔒 A page you can't open" or "This page was deleted": no ID, title or anything else. */
  | { type: 'page' | 'event'; state: 'locked' | 'deleted' };

export type NoticeButtonView =
  | { type: 'link'; label: string; href: string }
  /** `choices` holds the menu's labels (empty when the button runs straight away). */
  | { type: 'action'; label: string; choices: string[] };

export interface NoticeView {
  id: string;
  /** Order in the chat (higher is newer). Paging cursors and "read up to here" use it. */
  position: number;
  kind: NoticeKind;
  sender: string;
  actorUserId: string | null;
  icon: string | null;
  title: string;
  text: string | null;
  card: NoticeCardView | null;
  buttons: NoticeButtonView[];
  /** How many notices were grouped into this one (1 when none were). */
  count: number;
  /** ISO instants: when it first arrived, and when it last arrived (shown in the chat). */
  createdAt: string;
  latestAt: string;
  read: boolean;
}

/** GET /api/notices: one page of the chat, newest first. */
export interface NoticeListResponse {
  notices: NoticeView[];
  /** Pass it as `before` to get the next, older page; null when there's none. */
  nextCursor: number | null;
  unread: number;
}

/** GET /api/notices/unread, and what the mark-as-read routes return. */
export interface NoticeUnreadResponse {
  unread: number;
}

/** POST /api/notices/:id/actions. */
export interface NoticeActionResponse {
  /** The handler's confirmation, such as "Snoozed for 1 hour". */
  message: string | null;
  unread: number;
}
