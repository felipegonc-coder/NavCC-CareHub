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
 * - `review`: a knowledge base page the person owns is due for review, or a review report.
 * - `form_response`: someone answered a form the person gets the responses of.
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
  'review',
  'form_response',
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
  /** One card. For more, use `cards` instead. */
  card?: NoticeCard;
  /**
   * 1 to 3 cards, shown in this order, instead of `card` (not both). Each reader sees each card
   * open or locked by their own access.
   */
  cards?: readonly NoticeCard[];
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
  /** Set when the person turned this kind of notice off in Settings: nothing was saved. */
  turnedOff?: true;
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

/**
 * The kinds of notices a person can turn off in Settings → Notifications (Settings spec 3.3),
 * each for one workspace. Mentions, replies, reminders and access requests are always on.
 * - `comments`: comments and suggested edits on pages they follow (`comment`, `suggestion`).
 * - `edits`: summaries of edits to pages they follow (`edit_summary`).
 * - `formResponses`: responses to their forms (`form_response`).
 * - `automations`: messages from automations (`automation`).
 */
export type NoticeSettingKey = 'comments' | 'edits' | 'formResponses' | 'automations';

/** On (true) or off for each; every kind is on until the person turns it off. */
export type NoticeSettings = Record<NoticeSettingKey, boolean>;

/** The live event type published to a person when their notice settings change. */
export const NOTICE_SETTINGS_CHANGED_EVENT = 'notice-settings-changed';

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
  /** The first card. */
  card: NoticeCardView | null;
  /** Every card, in order: up to 3, `card` first. */
  cards: NoticeCardView[];
  buttons: NoticeButtonView[];
  /** How many notices were grouped into this one (1 when none were). */
  count: number;
  /** ISO instants: when it first arrived, and when it last arrived (shown in the chat). */
  createdAt: string;
  latestAt: string;
  read: boolean;
}

/** One notice, as `getNotice(db, noticeId)` returns it, such as for a push notification. */
export interface NoticeSummary {
  id: string;
  workspaceId: string;
  /** Whose 🔔 chat it's in: the only person it may be shown to. */
  userId: string;
  kind: NoticeKind;
  /** Generic, never a page or event title. */
  title: string;
  text: string | null;
  /** The `sender` it was sent with. */
  senderName: string;
  /**
   * A relative path: the first link button's, else the first page card's page (`/p/<pageId>`),
   * else the 🔔 Care Hub chat (`/messages/care-hub`).
   */
  link: string;
  /** When it first arrived. */
  createdAt: Date;
  /** When its latest part arrived: later than `createdAt` only for a grouped notice. */
  latestAt: Date;
}
