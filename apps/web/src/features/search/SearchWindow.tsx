import {
  SEARCH_MAX_RESULTS,
  SEARCH_TEXT_MAX,
  type RecentSearch,
  type SearchResult,
} from '@carehub/extras/search';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  Kbd,
  Skeleton,
  useOnline,
  VisuallyHidden,
} from '@carehub/ui';
import { Clock, Search, X, Zap } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { slots, type Command } from '../../slots';
import { useDebounced, useRecent, useResults, useSearchActions } from './data';
import { FilterBar, type SearchOptions } from './FilterBar';
import { hasFilters } from './filters';
import { matchCommands, modifierLabel } from './keys';
import { ResultContent, resultLabel } from './ResultRow';

type Option =
  | { type: 'action'; key: string; command: Command }
  | { type: 'result' | 'page'; key: string; result: SearchResult }
  | { type: 'search'; key: string; search: RecentSearch };

interface Section {
  id: string;
  /** Shown as the group's heading; results have none. */
  label: string;
  heading: boolean;
  options: Option[];
  action?: ReactNode;
}

/** True once `on` has stayed true for `ms`. */
function useAfter(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) return setLate(false);
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && late;
}

const optionClasses =
  'flex cursor-default select-none items-start gap-2 rounded px-2 py-1.5 text-small aria-selected:bg-fill-hover max-md:min-h-11';

/**
 * The search window (spec 2): a search box, then the recent lists before typing, or Actions and
 * results. A combobox: ↑ and ↓ move through every list, Enter opens, Esc closes and puts the
 * focus back where it was.
 */
export default function SearchWindow({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [returnTo] = useState(() => document.activeElement as HTMLElement | null);
  const [text, setText] = useState('');
  const typed = useDebounced(text, 80);
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    filters: {},
    sort: 'best',
    names: {},
  });
  const { filters, sort } = searchOptions;
  const request = typed.trim() ? { text: typed, filters, sort } : null;
  const results = useResults(request);
  const recent = useRecent();
  const actions = useSearchActions();
  const online = useOnline();
  const loadMore = () => {
    if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
  };

  const shown = results.data?.pages.flatMap((page) => page.results) ?? [];
  const total = results.data?.pages[0]?.total ?? 0;
  const offline = !online || (results.error as { code?: string } | null)?.code === 'offline';
  const searching = text.trim() !== '' && !offline;

  // Each search counts once for Analytics (spec 3.4): when a result opens, on Enter (both also
  // save it to Recent searches), or when the window closes.
  const counted = useRef<string | null>(null);
  function record(save: boolean, opened?: string) {
    const search = JSON.stringify(request);
    if (!request || !results.data || counted.current === search) return;
    counted.current = search;
    actions.record({
      text: request.text,
      ...(hasFilters(filters) ? { filters } : {}),
      save,
      found: total,
      ...(opened ? { opened } : {}),
    });
  }

  function dismiss() {
    record(false);
    onClose();
  }

  function clearFilters() {
    setSearchOptions({ ...searchOptions, filters: {} });
    input.current?.focus();
  }

  /** "Did you mean": searches for the suggestion instead. */
  function retype(suggestion: string) {
    setText(suggestion);
    input.current?.focus();
  }

  /** Trash opens with the same search (docs/extras/search.md, With other features). */
  function searchTrash() {
    dismiss();
    navigate(`/trash?q=${encodeURIComponent(typed.trim())}`);
  }

  const sections: Section[] = searching
    ? [
        {
          id: 'actions',
          label: 'Actions',
          heading: true,
          options: matchCommands(slots.commands, text).map((command) => ({
            type: 'action',
            key: `action-${command.id}`,
            command,
          })),
        },
        {
          id: 'results',
          label: 'Results',
          heading: false,
          options: shown.map((result) => ({ type: 'result', key: result.id, result })),
        },
      ]
    : [
        {
          id: 'recent',
          label: 'Recent',
          heading: true,
          options: (recent.data?.pages ?? []).map((result) => ({
            type: 'page',
            key: `page-${result.id}`,
            result,
          })),
        },
        {
          id: 'searches',
          label: 'Recent searches',
          heading: true,
          options: offline
            ? []
            : (recent.data?.searches ?? []).map((search) => ({
                type: 'search',
                key: `search-${search.id}`,
                search,
              })),
          action: (
            <Button variant="ghost" size="sm" onClick={actions.clear}>
              Clear
            </Button>
          ),
        },
      ];
  const lists = sections.filter((section) => section.options.length > 0);
  const options = lists.flatMap((section) => section.options);

  // The first option is selected whenever the list changes (spec 2).
  const listKey = searching ? `q:${JSON.stringify(request)}` : 'recent';
  const [selected, setSelected] = useState({ listKey, index: 0 });
  const active = Math.min(selected.listKey === listKey ? selected.index : 0, options.length - 1);
  const activeOption = options[active];
  const optionId = (option: Option) => `${id}-${option.key}`;
  const select = (index: number) => setSelected({ listKey, index });

  useEffect(() => {
    if (activeOption)
      document.getElementById(optionId(activeOption))?.scrollIntoView?.({ block: 'nearest' });
  });

  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const end = more.current;
    if (!end || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    });
    observer.observe(end);
    return () => observer.disconnect();
  });

  function openPage(result: SearchResult, newTab: boolean) {
    const to = `/p/${result.id}`;
    if (newTab) {
      window.open(to, '_blank', 'noopener');
      return;
    }
    // stand-in: Shift+Enter opens the side panel once the page view has one (Pages lane).
    onClose();
    navigate(to);
  }

  function choose(option: Option, newTab = false) {
    if (option.type === 'search') {
      setText(option.search.text);
      setSearchOptions({ ...searchOptions, filters: option.search.filters });
      input.current?.focus();
      return;
    }
    if (option.type === 'action') {
      onClose();
      void option.command.run({ navigate: (to) => navigate(to) });
      return;
    }
    if (option.type === 'result') record(true, option.result.id);
    openPage(option.result, newTab);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = active + (event.key === 'ArrowDown' ? 1 : -1);
      select(Math.max(0, Math.min(options.length - 1, next)));
      if (next >= options.length - 3) loadMore();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption) choose(activeOption, event.ctrlKey || event.metaKey);
      else record(true);
    } else if (event.key === 'Delete' && activeOption?.type === 'search' && !text) {
      event.preventDefault();
      actions.remove(activeOption.search.id);
    }
  }

  const waiting = useAfter(searching && results.isFetching && shown.length === 0, 150);
  const settled = searching && results.isSuccess && !results.isPlaceholderData;
  const empty = settled && total === 0;
  const failed = searching && results.isError;
  const suggestion = settled ? results.data?.pages[0]?.didYouMean : undefined;
  const didYouMean = suggestion && (
    <p className="px-2 text-center text-small text-muted">
      Did you mean{' '}
      <button
        type="button"
        className="rounded-sm font-medium text-fg underline underline-offset-2 hover:text-primary"
        onClick={() => retype(suggestion)}
      >
        {suggestion}
      </button>
      ?
    </p>
  );
  // Read out by screen readers; the visible "No results for ‘…’." is its own line.
  const status = !searching
    ? ''
    : empty
      ? 'No results'
      : results.data
        ? `${total >= SEARCH_MAX_RESULTS ? `${total}+` : total} ${total === 1 ? 'result' : 'results'}`
        : '';

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && dismiss()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-w-page flex-col gap-0 overflow-hidden p-0 max-md:-m-4 max-md:h-dvh max-md:w-screen max-md:rounded-none max-md:border-0"
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault();
          returnTo?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4 pr-12">
          <Search aria-hidden className="size-4 shrink-0 text-muted" />
          <input
            ref={input}
            role="combobox"
            aria-label="Search"
            aria-expanded={options.length > 0}
            aria-controls={lists.map((section) => `${id}-${section.id}`).join(' ') || undefined}
            aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            maxLength={SEARCH_TEXT_MAX}
            placeholder="Search pages, databases and rows"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-body text-fg placeholder:text-faint focus:outline-none max-md:h-14"
          />
        </div>
        <FilterBar options={searchOptions} onChange={setSearchOptions} onClear={clearFilters} />
        <VisuallyHidden role="status">{status}</VisuallyHidden>
        <div className="flex max-h-96 min-h-0 flex-col gap-3 overflow-y-auto p-2 max-md:max-h-none max-md:flex-1">
          {offline && (
            <p className="px-2 pt-1 text-small text-muted">You're offline. Showing recent pages.</p>
          )}
          {lists.map((section) => (
            <div key={section.id} role="group" aria-labelledby={`${id}-${section.id}-label`}>
              <div
                className={cn(
                  'flex h-8 items-center justify-between px-2 text-label font-medium text-muted',
                  !section.heading && 'sr-only',
                )}
              >
                <span id={`${id}-${section.id}-label`}>{section.label}</span>
                {section.action}
              </div>
              <div
                role="listbox"
                id={`${id}-${section.id}`}
                aria-labelledby={`${id}-${section.id}-label`}
              >
                {section.options.map((option) => {
                  const index = options.indexOf(option);
                  return (
                    <div
                      key={option.key}
                      id={optionId(option)}
                      role="option"
                      aria-selected={index === active}
                      aria-label={labelOf(option)}
                      tabIndex={-1}
                      className={optionClasses}
                      onMouseMove={() => index !== active && select(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => choose(option, event.ctrlKey || event.metaKey)}
                      onKeyDown={(event) => event.key === 'Enter' && choose(option)}
                    >
                      <OptionContent option={option} onRemove={actions.remove} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {searching && <div ref={more} />}
          {waiting &&
            [0, 1, 2].map((row) => (
              <div key={row} className="flex gap-2 px-2 py-1.5">
                <Skeleton className="size-5" />
                <Skeleton className="h-5 flex-1" />
              </div>
            ))}
          {empty ? (
            <div className="flex flex-col items-center gap-3 px-2 py-6 text-center text-small text-muted">
              <p>{`No results for ‘${typed.trim()}’.`}</p>
              {didYouMean}
              <div className="flex flex-wrap justify-center gap-2">
                {hasFilters(filters) && (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={searchTrash}>
                  Search in Trash
                </Button>
              </div>
            </div>
          ) : (
            didYouMean
          )}
          {failed && !offline && (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-small">
              <p>Search isn't working right now.</p>
              <Button variant="secondary" size="sm" onClick={() => void results.refetch()}>
                Try again
              </Button>
            </div>
          )}
          {!searching && !offline && options.length === 0 && recent.isFetched && (
            <p className="px-2 py-6 text-center text-small text-muted">
              Type to search pages, databases and rows.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2 text-label text-muted max-md:hidden">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>Enter</Kbd> open
          </span>
          <span>
            <Kbd>{modifierLabel(navigator.userAgent)}</Kbd> <Kbd>Enter</Kbd> new tab
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function labelOf(option: Option): string {
  if (option.type === 'action') return option.command.title;
  if (option.type === 'search') return option.search.text;
  return resultLabel(option.result);
}

function OptionContent({ option, onRemove }: { option: Option; onRemove: (id: string) => void }) {
  if (option.type === 'action') {
    return (
      <>
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-muted">
          <Zap className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{option.command.title}</span>
      </>
    );
  }
  if (option.type === 'search') {
    const { search } = option;
    return (
      <>
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-muted">
          <Clock className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{search.text}</span>
        {/* Not a button inside the option: the keyboard's Delete removes it too. */}
        <span
          aria-hidden
          title="Remove"
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-fill hover:text-fg"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(search.id);
          }}
        >
          <X className="size-3.5" />
        </span>
      </>
    );
  }
  return <ResultContent result={option.result} compact={option.type === 'page'} />;
}
