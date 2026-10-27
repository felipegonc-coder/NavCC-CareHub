import { useMemo } from 'react';
import { Link } from 'react-router';
import {
  highlightRanges,
  highlightSegments,
  parseSearchQuery,
  type ChatListResponse,
  type MessageJson,
  type PeopleJson,
  type SearchQuery,
} from '@carehub/team-chat';
import { todayIn } from '@carehub/team-time';
import { Avatar, Button, cn, VisuallyHidden } from '@carehub/ui';
import { chatHref, nameLookup, senderName, titleOf } from './chat-info';
import { CareHubItem, ChatItem } from './ChatList';
import { useMessageSearch } from './data';
import { fullTime, listTime, TIME_SETTINGS } from './format';
import { useAfter } from './hooks';
import { LoadError } from './LoadError';
import { readableText } from './mentions';
import { anyFilter, matchingChats, searchBody, snippet, type SearchFilters } from './search';

/** A search result's link: the chat, scrolled to the message and highlighted. */
export const messageHref = (message: Pick<MessageJson, 'id' | 'chatId'>) =>
  `${chatHref(message.chatId)}?message=${encodeURIComponent(message.id)}`;

function Highlighted({ text, query }: { text: string; query: SearchQuery }) {
  const shown = snippet(text, highlightRanges(text, query));
  return (
    <>
      {highlightSegments(shown.text, shown.ranges).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-sm bg-warning/20 text-fg">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function MessageResult({
  message,
  answer,
  people,
  query,
}: {
  message: MessageJson;
  answer: ChatListResponse | null | undefined;
  people: PeopleJson;
  query: SearchQuery;
}) {
  const name = senderName(message, people);
  const sender = message.senderId === answer?.viewerId ? 'You' : name;
  const chat = answer?.chats.find((item) => item.id === message.chatId);
  const chatTitle = chat && answer ? titleOf(chat, answer.viewerId, people) : null;
  const text = readableText(message.text, message.mentions, nameLookup(people));
  return (
    <li>
      <Link
        to={messageHref(message)}
        className="flex gap-3 rounded px-3 py-2 hover:bg-fill-hover"
        data-testid="messages-search-result"
      >
        <Avatar name={name} size="sm" decorative />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-small">
              <span className="font-medium">{sender}</span>
              {chatTitle && chatTitle !== sender && (
                <span className="text-muted"> · {chatTitle}</span>
              )}
            </span>
            <time
              dateTime={message.createdAt}
              title={fullTime(message.createdAt)}
              className="shrink-0 text-small text-muted"
            >
              {listTime(message.createdAt, new Date())}
            </time>
          </span>
          <span className="line-clamp-2 break-words text-small">
            <Highlighted text={text} query={query} />
          </span>
        </span>
      </Link>
    </li>
  );
}

function Searching() {
  const show = useAfter(300);
  return (
    <p
      aria-busy="true"
      className="px-4 py-2 text-small text-muted"
      data-testid="messages-searching"
    >
      {show ? 'Searching…' : <VisuallyHidden>Searching…</VisuallyHidden>}
    </p>
  );
}

const found = (count: number, more: boolean) =>
  more
    ? `The newest ${count} messages that match.`
    : `${count} ${count === 1 ? 'message' : 'messages'} found.`;

interface ResultsProps {
  text: string;
  /** The words are still being typed: the search hasn't been asked yet. */
  typing: boolean;
  filters: SearchFilters;
  answer: ChatListResponse | null | undefined;
  onClearFilters(): void;
}

/** Search results: chats by name or member (without filters), then messages, newest first. */
export function SearchResults({ text, typing, filters, answer, onClearFilters }: ResultsProps) {
  const query = useMemo(() => parseSearchQuery(text), [text]);
  const today = todayIn(TIME_SETTINGS.timeZone);
  const body = useMemo(() => searchBody(text, filters, today), [text, filters, today]);
  const search = useMessageSearch(body);
  const filtered = anyFilter(filters);
  const chats = useMemo(() => matchingChats(answer, query), [answer, query]);
  const showChats = !filtered && (chats.careHub || chats.chats.length > 0);
  const answerPeople = answer?.people;
  const resultPeople = search.data?.people;
  const people = useMemo(
    () => ({ ...answerPeople, ...resultPeople }),
    [answerPeople, resultPeople],
  );
  const results = body ? search.data?.results : [];
  const settled = !typing && (body === null || (search.isSuccess && !search.isFetching));
  const status = !settled
    ? ''
    : results?.length
      ? found(results.length, Boolean(search.data?.hasMore))
      : 'No messages match.';

  return (
    <section
      aria-label="Search results"
      className="min-h-0 flex-1 overflow-y-auto pb-2"
      data-testid="messages-search-results"
    >
      {showChats && (
        <>
          <h2 className="px-4 pb-1 pt-3 text-label text-muted">Chats</h2>
          <ul className="flex flex-col gap-1 px-2" data-testid="messages-search-chats">
            {chats.careHub && <CareHubItem />}
            {answer &&
              chats.chats.map((chat) => <ChatItem key={chat.id} chat={chat} answer={answer} />)}
          </ul>
        </>
      )}
      <h2 className="px-4 pb-1 pt-3 text-label text-muted">Messages</h2>
      {search.isError ? (
        <LoadError message={search.error?.message ?? ''} onRetry={() => void search.refetch()} />
      ) : results === undefined || (typing && results.length === 0) ? (
        <Searching />
      ) : results.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-4 py-2">
          <p className="text-muted" data-testid="messages-search-empty">
            No messages match.
          </p>
          {filtered && (
            <Button variant="secondary" size="sm" onClick={onClearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul
            aria-busy={search.isPlaceholderData || undefined}
            className={cn('flex flex-col gap-1 px-2', search.isPlaceholderData && 'opacity-60')}
            data-testid="messages-search-messages"
          >
            {results.map((message) => (
              <MessageResult
                key={message.id}
                message={message}
                answer={answer}
                people={people}
                query={query}
              />
            ))}
          </ul>
          {search.data?.hasMore && (
            <p className="px-4 py-2 text-small text-muted">
              Showing the newest 50. Add words or filters to find older ones.
            </p>
          )}
        </>
      )}
      <div role="status" className="sr-only" data-testid="messages-search-status">
        {status}
      </div>
    </section>
  );
}
