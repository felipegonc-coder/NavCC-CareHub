/** Limits from the Messages spec (and the lead's decisions where the spec is silent). */

/** Longest message, in characters: Unicode code points, as Postgres `char_length` counts them. */
export const MESSAGE_MAX_LENGTH = 4000;
/** The composer shows a character counter from this many characters. */
export const MESSAGE_COUNTER_FROM = 3800;
/** Raw text longer than this (UTF-16 units) is refused before any other work. */
export const MESSAGE_RAW_MAX = 16_000;
/** Page cards per message. */
export const PAGE_CARDS_MAX = 10;
/** Files per message (lead's decision). */
export const ATTACHMENTS_MAX = 10;
/** Different emoji per message. */
export const REACTIONS_MAX_DISTINCT = 20;
/** Quick reactions, in the spec's order. */
export const QUICK_REACTIONS = ['👍', '\u2764\uFE0F', '😂', '🎉', '👀', '✅'] as const;
/** People in a group when it's started or grown, the starter included. */
export const GROUP_MIN_PEOPLE = 3;
export const GROUP_MAX_PEOPLE = 50;
/** Not in the spec (open question). */
export const GROUP_NAME_MAX_LENGTH = 100;
/** Not in the spec (open question). */
export const DESCRIPTION_MAX_LENGTH = 1000;
/** Older messages load this many at a time. */
export const HISTORY_PAGE_SIZE = 50;
/** Above this the badge shows "99+". */
export const BADGE_MAX = 99;
/** Notifications show this many characters of the message. */
export const NOTIFICATION_TEXT_LENGTH = 100;
/** Search box input is cut to this many UTF-16 units, and to this many words. */
export const SEARCH_QUERY_MAX_LENGTH = 200;
export const SEARCH_MAX_WORDS = 16;

/** Wording shared by web and server (the spec's own words where it has them). */
export const COPY = {
  careHubChatName: 'Care Hub',
  careHubChatNote: 'Care Hub sends reminders, automations and alerts here.',
  addPeopleWarning: "They'll see earlier messages.",
  deletedMessage: 'This message was deleted',
  lockedPageCard: "🔒 A page you can't open",
  deletedPageCard: 'This page was deleted',
  edited: 'edited',
  removedSuffix: '(removed)',
  unknownPerson: 'Unknown person',
  unnamedEmptyGroup: 'Group chat',
  hiddenMessageText: 'New message',
  hiddenNoticeText: 'New notice',
} as const;
