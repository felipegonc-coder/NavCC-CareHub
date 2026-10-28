import { SEARCH_MAX_RESULTS, SEARCH_TEXT_MAX, type SearchResult } from '@carehub/extras/search';
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
import { Search, Zap } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { slots, type Command } from '../../slots';
import { useResults } from './data';
import { matchCommands, modifierLabel } from './keys';
import { ResultContent, resultLabel } from './ResultRow';

type Option =
  | { type: 'action'; key: string; command: Command }
  | { type: 'result'; key: string; result: SearchResult };

interface Section {
  id: string;
  /** Shown as the group's heading; results have none. */
  label: string;
  heading: boolean;
  options: Option[];
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
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
 * The search window (spec 2): a search box, then Actions and results. (Recent pages and searches
 * before typing come with the recent lists.) A combobox: ↑ and ↓ move through every list, Enter opens, Esc closes and puts the
 * focus back where it was.
 */
export default function SearchWindow({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [returnTo] = useState(() => document.activeElement as HTMLElement | null);
  const [text, setText] = useState('');
  const typed = useDebounced(text, 80);
  const request = typed.trim() ? { text: typed } : null;
  const results = useResults(request);
  const online = useOnline();
  const loadMore = () => {
    if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
  };

  const shown = results.data?.pages.flatMap((page) => page.results) ?? [];
  const total = results.data?.pages[0]?.total ?? 0;
  const offline = !online || (results.error as { code?: string } | null)?.code === 'offline';
  const searching = text.trim() !== '' && !offline;

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
    : [];
  const lists = sections.filter((section) => section.options.length > 0);
  const options = lists.flatMap((section) => section.options);

  // The first option is selected whenever the list changes (spec 2).
  const listKey = `q:${typed}`;
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
    if (option.type === 'action') {
      onClose();
      void option.command.run({ navigate: (to) => navigate(to) });
      return;
    }
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
    }
  }

  const waiting = useAfter(searching && results.isFetching && shown.length === 0, 150);
  const empty = searching && results.isSuccess && !results.isPlaceholderData && total === 0;
  const failed = searching && results.isError;
  // Read out by screen readers; the visible "No results for ‘…’." is its own line.
  const status = !searching
    ? ''
    : empty
      ? 'No results'
      : results.data
        ? `${total >= SEARCH_MAX_RESULTS ? `${total}+` : total} ${total === 1 ? 'result' : 'results'}`
        : '';

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
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
        <VisuallyHidden role="status">{status}</VisuallyHidden>
        <div className="flex max-h-96 min-h-0 flex-col gap-3 overflow-y-auto p-2 max-md:max-h-none max-md:flex-1">
          {offline && (
            <p className="px-2 py-6 text-center text-small text-muted">
              You're offline. Search works again once you're back online.
            </p>
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
                      <OptionContent option={option} />
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
          {empty && (
            <p className="px-2 py-6 text-center text-small text-muted">{`No results for ‘${typed.trim()}’.`}</p>
          )}
          {failed && !offline && (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-small">
              <p>Search isn't working right now.</p>
              <Button variant="secondary" size="sm" onClick={() => void results.refetch()}>
                Try again
              </Button>
            </div>
          )}
          {!searching && !offline && (
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
  return option.type === 'action' ? option.command.title : resultLabel(option.result);
}

function OptionContent({ option }: { option: Option }) {
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
  return <ResultContent result={option.result} />;
}
