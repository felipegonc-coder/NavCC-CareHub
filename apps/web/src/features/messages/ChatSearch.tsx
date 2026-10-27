import { Search, SlidersHorizontal } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { useSearchParams } from 'react-router';
import { IconButton, Input } from '@carehub/ui';
import { ChatList } from './ChatList';
import { useChatList } from './data';
import { useDebounced } from './hooks';
import { anyFilter, NO_FILTERS, type SearchFilters } from './search';
import { SearchFilterBar } from './SearchFilterBar';
import { SearchResults } from './SearchResults';

/** Search waits this long after the last key. */
const TYPING_PAUSE_MS = 250;

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
