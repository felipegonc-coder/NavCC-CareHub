import { Search, SlidersHorizontal } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { Link, useSearchParams } from 'react-router';
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
import {
  Avatar,
  Button,
  cn,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VisuallyHidden,
} from '@carehub/ui';
import { chatHref, nameLookup, senderName, titleOf } from './chat-info';
import { CareHubItem, ChatItem, ChatList } from './ChatList';
import { useChatList, useMessageSearch } from './data';
import { fullTime, listTime, TIME_SETTINGS } from './format';
import { useAfter, useDebounced } from './hooks';
import { LoadError } from './LoadError';
import { readableText } from './mentions';
import {
  anyFilter,
  DATE_CHOICES,
  dateLabel,
  fromChoices,
  HAS_CHOICES,
  inChoices,
  matchingChats,
  NO_FILTERS,
  searchBody,
  snippet,
  type SearchFilters,
} from './search';

/** Search waits this long after the last key. */
const TYPING_PAUSE_MS = 250;
/** The filters' "no filter" choice (a Select item can't have an empty value). */
const ANY = 'any';

/** A search result's link: the chat, scrolled to the message and highlighted. */
export const messageHref = (message: Pick<MessageJson, 'id' | 'chatId'>) =>
  `${chatHref(message.chatId)}?message=${encodeURIComponent(message.id)}`;

/** Ctrl+Shift+F, or /messages?q=… (Search messages in Ctrl+K), goes to the search box. */
function useSearchEntry(
  inputRef: RefObject<HTMLInputElement | null>,
  setText: (text: string) => void,
) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('q');
  useEffect(() => {
    if (asked === null) return;
    setText(asked);
    inputRef.current?.focus();
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [asked, inputRef, setParams, setText]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
      const input = inputRef.current;
      if (event.key.toLowerCase() !== 'f' || !input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inputRef]);
}

/** ↑ and ↓ move from the search box through the chats or results under it; Enter opens one. */
function useArrowKeys(
  paneRef: RefObject<HTMLDivElement | null>,
  inputRef: RefObject<HTMLInputElement | null>,
) {
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const links = Array.from(pane.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(
        (link) => link.getClientRects().length > 0,
      );
      const input = inputRef.current;
      const down = event.key === 'ArrowDown';
      if (event.target === input) {
        if (down && links[0]) {
          event.preventDefault();
          links[0].focus();
        }
        return;
      }
      const index = links.findIndex((link) => link === event.target);
      if (index === -1) return;
      event.preventDefault();
      const next = links[index + (down ? 1 : -1)];
      if (next) next.focus();
      else if (!down) input?.focus();
    };
    pane.addEventListener('keydown', onKeyDown);
    return () => pane.removeEventListener('keydown', onKeyDown);
  }, [paneRef, inputRef]);
}

interface FilterSelectProps<V extends string> {
  name: string;
  value: V | null;
  choices: readonly { value: V; label: string }[];
  /** The "no filter" choice, such as "Anyone". */
  anyLabel: string;
  /** The button's text when a choice is picked, if not the choice's own. */
  shown?: string;
  onChange(value: V | null): void;
  testId: string;
}

function FilterSelect<V extends string>({
  name,
  value,
  choices,
  anyLabel,
  shown,
  onChange,
  testId,
}: FilterSelectProps<V>) {
  const current = choices.find((choice) => choice.value === value);
  return (
    <Select
      value={current ? current.value : ANY}
      onValueChange={(picked) =>
        onChange(choices.find((choice) => choice.value === picked)?.value ?? null)
      }
    >
      <SelectTrigger
        aria-label={`${name}: ${current?.label ?? anyLabel}`}
        className={cn('h-8 w-auto max-w-40 gap-1 px-2', current && 'border-primary')}
        data-testid={testId}
      >
        <SelectValue>{current ? (shown ?? current.label) : name}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const DAY_CHOICES = new Set(['on', 'before', 'after', 'between']);

function SearchFilterBar({
  id,
  answer,
  filters,
  onChange,
}: {
  id: string;
  answer: ChatListResponse | null | undefined;
  filters: SearchFilters;
  onChange(filters: SearchFilters): void;
}) {
  const people = useMemo(() => fromChoices(answer), [answer]);
  const chats = useMemo(() => inChoices(answer), [answer]);
  const set = (change: Partial<SearchFilters>) => onChange({ ...filters, ...change });
  return (
    <div id={id} className="flex flex-col gap-2" data-testid="messages-search-filters">
      <div className="flex flex-wrap items-center gap-1">
        <FilterSelect
          name="From"
          value={filters.fromUserId}
          choices={people}
          anyLabel="Anyone"
          onChange={(fromUserId) => set({ fromUserId })}
          testId="messages-filter-from"
        />
        <FilterSelect
          name="In"
          value={filters.chatId}
          choices={chats}
          anyLabel="All chats"
          onChange={(chatId) => set({ chatId })}
          testId="messages-filter-in"
        />
        <FilterSelect
          name="Date"
          value={filters.date === 'any' ? null : filters.date}
          choices={DATE_CHOICES.slice(1)}
          anyLabel="Any time"
          shown={dateLabel(filters)}
          onChange={(date) => set({ date: date ?? 'any' })}
          testId="messages-filter-date"
        />
        <FilterSelect
          name="Has"
          value={filters.has}
          choices={HAS_CHOICES}
          anyLabel="Anything"
          onChange={(has) => set({ has })}
          testId="messages-filter-has"
        />
        {anyFilter(filters) && (
          <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
            Clear filters
          </Button>
        )}
      </div>
      {DAY_CHOICES.has(filters.date) && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label={filters.date === 'between' ? 'First day' : 'Day'}
            value={filters.day}
            onChange={(event) => set({ day: event.target.value })}
            className="h-8"
            data-testid="messages-filter-day"
          />
          {filters.date === 'between' && (
            <>
              <span className="text-small text-muted">to</span>
              <Input
                type="date"
                aria-label="Last day"
                value={filters.lastDay}
                onChange={(event) => set({ lastDay: event.target.value })}
                className="h-8"
                data-testid="messages-filter-last-day"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

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
function SearchResults({ text, typing, filters, answer, onClearFilters }: ResultsProps) {
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

/** The chat list under the search box; while searching, the chats and messages that match. */
export function ChatsPane({ activeId }: { activeId: string | null }) {
  const list = useChatList();
  // Guests have only the 🔔 chat: nothing to search.
  const guest = list.data === null;
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const words = useDebounced(text, TYPING_PAUSE_MS);
  const inputRef = useRef<HTMLInputElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const filtersId = useId();
  useSearchEntry(inputRef, setText);
  useArrowKeys(paneRef, inputRef);

  const filtered = anyFilter(filters);
  const searching = !guest && (text.trim() !== '' || filtered);
  const filtersShown = !guest && (searching || filtersOpen);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape' || (!text && !filtersShown)) return;
    event.preventDefault();
    if (text) {
      setText('');
    } else {
      setFilters(NO_FILTERS);
      setFiltersOpen(false);
    }
  };

  return (
    <div ref={paneRef} className="flex min-h-0 flex-1 flex-col">
      {!guest && (
        <div role="search" className="flex shrink-0 flex-col gap-2 border-b border-border p-2">
          <div className="flex items-center gap-1">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
              />
              <Input
                ref={inputRef}
                type="search"
                aria-label="Search messages"
                placeholder="Search"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={onKeyDown}
                className="pl-8"
                data-testid="messages-search"
              />
            </div>
            {!searching && (
              <IconButton
                label="Filters"
                variant="ghost"
                aria-expanded={filtersShown}
                aria-controls={filtersId}
                onClick={() => setFiltersOpen((open) => !open)}
                data-testid="messages-search-filters-toggle"
              >
                <SlidersHorizontal className="size-4" aria-hidden />
              </IconButton>
            )}
          </div>
          {filtersShown && (
            <SearchFilterBar
              id={filtersId}
              answer={list.data}
              filters={filters}
              onChange={setFilters}
            />
          )}
        </div>
      )}
      <ChatList activeId={activeId} hidden={searching} />
      {searching && (
        <SearchResults
          text={words}
          typing={words !== text}
          filters={filters}
          answer={list.data}
          onClearFilters={() => setFilters(NO_FILTERS)}
        />
      )}
    </div>
  );
}
