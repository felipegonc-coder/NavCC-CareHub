// The assistant's question box (Claude features spec, sections 2, 3.3 and 6): Enter sends and
// Shift+Enter adds a line; the chip says what Claude may read; @ adds up to 5 pages, found with
// Care Hub Search as the person; Stop ends the answer on its way.
import {
  ASSISTANT_SCOPE_LABELS,
  ASSISTANT_SCOPES,
  AT_PAGES_MAX,
  QUESTION_MAX,
  type AssistantPageLink,
  type AssistantScope,
} from '@carehub/extras/claude/assistant';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Spinner,
  Textarea,
  VisuallyHidden,
} from '@carehub/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowUp,
  AtSign,
  Ban,
  ChevronDown,
  FileText,
  Library,
  Square,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { findPages, personKey } from './api';

export const SEND_HINT = 'Enter sends. Shift+Enter adds a line.';
/** Typing in Find a page waits this long before searching. */
export const FIND_DELAY_MS = 200;

const SCOPE_ICONS: Readonly<Record<AssistantScope, LucideIcon>> = {
  this_page: FileText,
  all_pages: Library,
  no_pages: Ban,
};

const titleOf = (page: AssistantPageLink) => page.title.trim() || 'Untitled';

export interface QuestionBoxProps {
  person: string;
  text: string;
  onTextChange: (text: string) => void;
  scope: AssistantScope;
  onScopeChange: (scope: AssistantScope) => void;
  /** This page needs a page open in the main area. */
  onPage: boolean;
  /** The pages added with @. */
  pages: readonly AssistantPageLink[];
  onPagesChange: (pages: AssistantPageLink[]) => void;
  waiting: boolean;
  onSend: () => void;
  onStop: () => void;
  boxRef: RefObject<HTMLTextAreaElement | null>;
}

export function QuestionBox({
  person,
  text,
  onTextChange,
  scope,
  onScopeChange,
  onPage,
  pages,
  onPagesChange,
  waiting,
  onSend,
  onStop,
  boxRef,
}: QuestionBoxProps) {
  const hint = useId();
  const [picking, setPicking] = useState(false);
  /** Where the typed @ is, so picking a page takes it out again. */
  const at = useRef<number | null>(null);
  /** Where the cursor goes once the text has changed. */
  const caret = useRef<number | null>(null);
  const full = pages.length >= AT_PAGES_MAX;

  useLayoutEffect(() => {
    if (caret.current === null) return;
    boxRef.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text, boxRef]);

  const change = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = event.target;
    onTextChange(value);
    const typedAt =
      value.length === text.length + 1 &&
      selectionStart > 0 &&
      value[selectionStart - 1] === '@' &&
      (selectionStart === 1 || /\s/.test(value[selectionStart - 2] ?? ''));
    if (typedAt && !full) {
      at.current = selectionStart - 1;
      setPicking(true);
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!waiting && text.trim()) onSend();
  };

  const pick = (page: AssistantPageLink) => {
    const spot = at.current;
    at.current = null;
    if (spot !== null && text[spot] === '@') {
      caret.current = spot;
      onTextChange(text.slice(0, spot) + text.slice(spot + 1));
    }
    if (!full && !pages.some(({ id }) => id === page.id)) onPagesChange([...pages, page]);
    setPicking(false);
  };

  return (
    <form
      className="flex shrink-0 flex-col gap-2 border-t p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!waiting && text.trim()) onSend();
      }}
    >
      {pages.length > 0 && (
        <ul aria-label="Pages Claude reads in full" className="flex flex-wrap gap-1">
          {pages.map((page) => (
            <li
              key={page.id}
              className="flex max-w-full items-center gap-1 rounded-full bg-fill py-0.5 pl-2 pr-0.5 text-label"
            >
              <span className="max-w-40 truncate">{titleOf(page)}</span>
              <IconButton
                label={`Remove ${titleOf(page)}`}
                size="sm"
                className="size-5 rounded-full"
                onClick={() => {
                  onPagesChange(pages.filter(({ id }) => id !== page.id));
                  boxRef.current?.focus();
                }}
              >
                <X aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Popover
        open={picking}
        onOpenChange={(open) => {
          setPicking(open);
          if (!open) at.current = null;
        }}
      >
        <PopoverAnchor asChild>
          <div>
            <VisuallyHidden id={hint}>{SEND_HINT}</VisuallyHidden>
            <Textarea
              ref={boxRef}
              aria-label="Question"
              aria-describedby={hint}
              placeholder="Ask Claude…"
              value={text}
              maxLength={QUESTION_MAX}
              rows={2}
              className="max-h-40 min-h-0 resize-none"
              onChange={change}
              onKeyDown={keyDown}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          side="top"
          className="p-2"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            boxRef.current?.focus();
          }}
        >
          <PagePicker person={person} chosen={pages} onPick={pick} />
        </PopoverContent>
      </Popover>
      <div className="flex items-center gap-1">
        <ScopeMenu scope={scope} onScopeChange={onScopeChange} onPage={onPage} />
        <IconButton
          label="Add a page"
          disabled={full}
          onClick={() => {
            at.current = null;
            setPicking(true);
          }}
        >
          <AtSign aria-hidden />
        </IconButton>
        <span className="flex-1" />
        {waiting ? (
          <IconButton label="Stop" variant="secondary" onClick={onStop}>
            <Square aria-hidden />
          </IconButton>
        ) : (
          <IconButton type="submit" label="Send" variant="primary" disabled={!text.trim()}>
            <ArrowUp aria-hidden />
          </IconButton>
        )}
      </div>
    </form>
  );
}

interface ScopeMenuProps {
  scope: AssistantScope;
  onScopeChange: (scope: AssistantScope) => void;
  onPage: boolean;
}

function ScopeMenu({ scope, onScopeChange, onPage }: ScopeMenuProps) {
  const Icon = SCOPE_ICONS[scope];
  const label = ASSISTANT_SCOPE_LABELS[scope];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`What Claude may read: ${label}`}>
          <Icon aria-hidden />
          <span className="max-w-40 truncate">{label}</span>
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel>What Claude may read</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={scope}
          onValueChange={(value) => {
            const next = ASSISTANT_SCOPES.find((one) => one === value);
            if (next) onScopeChange(next);
          }}
        >
          {ASSISTANT_SCOPES.map((one) => (
            <DropdownMenuRadioItem key={one} value={one} disabled={one === 'this_page' && !onPage}>
              {ASSISTANT_SCOPE_LABELS[one]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

interface PagePickerProps {
  person: string;
  chosen: readonly AssistantPageLink[];
  onPick: (page: AssistantPageLink) => void;
}

/** Find a page: only pages the person can open come back (section 3.3). */
function PagePicker({ person, chosen, onPick }: PagePickerProps) {
  const [find, setFind] = useState('');
  const words = useDebounced(find.trim(), FIND_DELAY_MS);
  const query = useQuery({
    queryKey: [...personKey(person), 'find', words],
    queryFn: ({ signal }) => findPages(words, signal),
    enabled: words.length > 0,
    placeholderData: keepPreviousData,
  });
  const found = words
    ? (query.data ?? []).filter(({ id }) => !chosen.some((page) => page.id === id))
    : [];

  let status: string;
  if (!words) status = 'Type to find a page.';
  else if (query.isError) status = "Couldn't search. Try again.";
  else if (query.isPending) status = '';
  else if (found.length === 0) status = 'No pages found.';
  else status = found.length === 1 ? '1 page found.' : `${found.length} pages found.`;

  return (
    <div className="flex flex-col gap-2">
      <Input
        aria-label="Find a page"
        placeholder="Find a page"
        value={find}
        onChange={(event) => setFind(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const first = found[0];
          if (first) onPick(first);
        }}
      />
      {words && query.isPending ? (
        <Spinner label="Finding pages" />
      ) : (
        <p role="status" className="px-1 text-label text-muted">
          {status}
        </p>
      )}
      {found.length > 0 && (
        <ul className="flex max-h-60 flex-col overflow-y-auto">
          {found.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                className="flex w-full min-w-0 items-center rounded px-2 py-1.5 text-left text-small hover:bg-fill-hover focus-visible:outline-offset-inset"
                onClick={() => onPick(page)}
              >
                <span className="truncate">{titleOf(page)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
