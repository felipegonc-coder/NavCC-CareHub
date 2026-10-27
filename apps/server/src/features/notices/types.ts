// The notices contract (decision 0007, section 4.4). Other lanes code against these names: keep
// them exactly as they are and only ever add optional fields.

/** What kind of notice it is. Each kind has its own default icon in the chat. */
export const NOTICE_KINDS = ['reminder', 'alert', 'mention', 'comment', 'automation'] as const;
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
}

export interface SendNoticeResult {
  noticeId: string;
  /** True when a recent notice with the same group key was updated instead of adding one. */
  grouped: boolean;
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
      /** ISO instant, or `YYYY-MM-DD` when `allDay`. */
      start: string;
      end: string | null;
      allDay: boolean;
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
