import {
  COPY,
  matchesSearch,
  parseSearchQuery,
  personName,
  toTsQuery,
  type ChatJson,
  type ChatListResponse,
  type DateFilter,
  type HasFilter,
  type MessageSearchBody,
  type SearchQuery,
  type TextRange,
} from '@carehub/team-chat';
import { addDays, formatDate, isCivilDate, type CivilDate } from '@carehub/team-time';
import { titleOf } from './chat-info';

/** The Date filter's choices; the last four ask for days. */
export const DATE_CHOICES = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Past 7 days' },
  { value: 'month', label: 'Past 30 days' },
  { value: 'on', label: 'On…' },
  { value: 'before', label: 'Before…' },
  { value: 'after', label: 'After…' },
  { value: 'between', label: 'Between…' },
] as const;
export type DateChoice = (typeof DATE_CHOICES)[number]['value'];

export const HAS_CHOICES: readonly { value: HasFilter; label: string }[] = [
  { value: 'picture', label: 'Picture' },
  { value: 'file', label: 'File' },
  { value: 'link', label: 'Link' },
  { value: 'pageCard', label: 'Page card' },
];

/** The From, In, Date and Has filters as the search box keeps them. */
export interface SearchFilters {
  fromUserId: string | null;
  chatId: string | null;
  date: DateChoice;
  /** The day for On, Before and After, and Between's first day: YYYY-MM-DD, or '' until picked. */
  day: string;
  /** Between's last day. */
  lastDay: string;
  has: HasFilter | null;
}

export const NO_FILTERS: SearchFilters = {
  fromUserId: null,
  chatId: null,
  date: 'any',
  day: '',
  lastDay: '',
  has: null,
};

export const anyFilter = (filters: SearchFilters): boolean =>
  filters.fromUserId !== null ||
  filters.chatId !== null ||
  filters.date !== 'any' ||
  filters.has !== null;

/** The Date filter to send: none for Any time, or until the days it needs are picked. */
export function dateFilterOf(filters: SearchFilters, today: CivilDate): DateFilter | undefined {
  const { date, day, lastDay } = filters;
  switch (date) {
    case 'any':
      return undefined;
    case 'today':
      return { op: 'on', date: today };
    case 'week':
      return { op: 'between', from: addDays(today, -6), to: today };
    case 'month':
      return { op: 'between', from: addDays(today, -29), to: today };
    case 'on':
    case 'before':
    case 'after':
      return isCivilDate(day) ? { op: date, date: day } : undefined;
    case 'between': {
      if (!isCivilDate(day) || !isCivilDate(lastDay)) return undefined;
      return day <= lastDay
        ? { op: 'between', from: day, to: lastDay }
        : { op: 'between', from: lastDay, to: day };
    }
  }
}

/** The Date filter's button: 'Date', 'Past 7 days', 'On Oct 26', 'Oct 2 – Oct 20'. */
export function dateLabel(filters: SearchFilters): string {
  const day = (value: string) => (isCivilDate(value) ? formatDate(value, { year: false }) : '…');
  switch (filters.date) {
    case 'any':
      return 'Date';
    case 'on':
      return `On ${day(filters.day)}`;
    case 'before':
      return `Before ${day(filters.day)}`;
    case 'after':
      return `After ${day(filters.day)}`;
    case 'between':
      return `${day(filters.day)} – ${day(filters.lastDay)}`;
    default:
      return DATE_CHOICES.find((choice) => choice.value === filters.date)?.label ?? 'Date';
  }
}

export const hasWords = (query: SearchQuery): boolean =>
  query.terms.length > 0 || query.phrases.length > 0;

/** What to ask the server, or null when there's nothing to look for: no words and no filters. */
export function searchBody(
  text: string,
  filters: SearchFilters,
  today: CivilDate,
): MessageSearchBody | null {
  const q = text.trim();
  const date = dateFilterOf(filters, today);
  const body: MessageSearchBody = {
    q,
    ...(filters.fromUserId ? { fromUserId: filters.fromUserId } : {}),
    ...(filters.chatId ? { chatId: filters.chatId } : {}),
    ...(date ? { date } : {}),
    ...(filters.has ? { has: filters.has } : {}),
  };
  const words = toTsQuery(parseSearchQuery(q)) !== null;
  const filtered = Boolean(body.fromUserId || body.chatId || body.date || body.has);
  return words || filtered ? body : null;
}

/** Chats whose name or members (other than you) match the words, in chat list order. */
export function matchingChats(
  answer: ChatListResponse | null | undefined,
  query: SearchQuery,
): { careHub: boolean; chats: ChatJson[] } {
  if (!hasWords(query)) return { careHub: false, chats: [] };
  const chats = (answer?.chats ?? []).filter((chat) => {
    const others = chat.members
      .filter((member) => member.userId !== answer?.viewerId)
      .map((member) => personName(answer?.people[member.userId]));
    const title = answer ? titleOf(chat, answer.viewerId, answer.people) : '';
    return matchesSearch([title, ...others], query);
  });
  return { careHub: matchesSearch(COPY.careHubChatName, query), chats };
}

export interface Choice {
  value: string;
  label: string;
}

/** From: you, then everyone you share a chat with, by name. */
export function fromChoices(answer: ChatListResponse | null | undefined): Choice[] {
  if (!answer) return [];
  const ids = new Set(answer.chats.flatMap((chat) => chat.members.map((member) => member.userId)));
  ids.delete(answer.viewerId);
  const others = [...ids]
    .map((id) => ({ value: id, label: personName(answer.people[id]) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: answer.viewerId, label: 'You' }, ...others];
}

/** In: your chats, in chat list order. */
export function inChoices(answer: ChatListResponse | null | undefined): Choice[] {
  if (!answer) return [];
  return answer.chats.map((chat) => ({
    value: chat.id,
    label: titleOf(chat, answer.viewerId, answer.people),
  }));
}

/** How much text stays before a long message's first match. */
const SNIPPET_LEAD = 40;

/**
 * A long message shown from shortly before its first match (starting at a word), so the match is
 * in the two lines a result shows.
 */
export function snippet(
  text: string,
  ranges: readonly TextRange[],
  lead = SNIPPET_LEAD,
): { text: string; ranges: TextRange[] } {
  const first = ranges[0];
  if (!first || first[0] <= lead) return { text, ranges: [...ranges] };
  const from = first[0] - lead;
  const space = text.slice(from, first[0]).search(/\s/u);
  const start = space === -1 ? first[0] : from + space + 1;
  const shift = start - 1;
  return {
    text: `…${text.slice(start)}`,
    ranges: ranges.map(([a, b]): TextRange => [a - shift, b - shift]),
  };
}
