import { SendHorizontal } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type RefObject } from 'react';
import { measureMessageText } from '@carehub/team-chat';
import { Avatar, Button, cn, IconButton, Kbd, Textarea } from '@carehub/ui';
import { findMentionQuery, insertMention, suggestPeople, type MentionQuery } from './mentions';

/** Someone in the chat who can be mentioned. */
export interface Mentionable {
  id: string;
  name: string;
}

/** The "@" list shows this many people; typing more of the name narrows it. */
const SUGGESTIONS_MAX = 8;

/** What people were writing in each chat, kept while they move between chats. */
const drafts = new Map<string, string>();

interface ComposerProps {
  chatId: string;
  /** "Message Sam Ortiz". */
  label: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** The others in the chat, for "@". */
  mentionable: readonly Mentionable[];
  /** The message being edited, as people read it; null for a new message. */
  editingText: string | null;
  saving: boolean;
  /** Why the last edit wasn't saved. */
  error: string | null;
  onSubmit(text: string): void;
  /** ↑ in an empty composer. */
  onEditLast(): void;
  onCancelEdit(): void;
}

/** Enter sends, Shift+Enter starts a new line, ↑ edits your last message, Esc cancels an edit. */
export function Composer({
  chatId,
  label,
  inputRef,
  mentionable,
  editingText,
  saving,
  error,
  onSubmit,
  onEditLast,
  onCancelEdit,
}: ComposerProps) {
  const editing = editingText !== null;
  const [text, setText] = useState(() => editingText ?? drafts.get(chatId) ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const counterId = useId();
  const listId = useId();
  const measure = measureMessageText(text);

  // "@" followed by the start of a name lists the people in the chat who match.
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  const suggestions = mention
    ? suggestPeople(mentionable, mention.query).slice(0, SUGGESTIONS_MAX)
    : [];
  const activePerson = suggestions[Math.min(active, suggestions.length - 1)];
  const optionId = (person: Mentionable) => `${listId}-${person.id}`;
  const watchCaret = (input: HTMLTextAreaElement) => {
    const next = findMentionQuery(input.value, input.selectionStart);
    setMention((current) =>
      current?.start === next?.start && current?.query === next?.query ? current : next,
    );
    if (next?.query !== mention?.query) setActive(0);
  };
  const pick = (person: Mentionable) => {
    const input = inputRef.current;
    if (!mention || !input) return;
    const next = insertMention(text, mention, input.selectionStart, person.name);
    change(next.text);
    setMention(null);
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(next.caret, next.caret);
    });
  };

  const change = (value: string) => {
    setText(value);
    setProblem(null);
    if (editing) return;
    if (value) drafts.set(chatId, value);
    else drafts.delete(chatId);
  };

  const submit = () => {
    if (measure.tooLong || saving) return;
    if (measure.blank) {
      if (editing) setProblem('Write something, or delete the message instead.');
      return;
    }
    onSubmit(text);
    if (!editing) change('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (activePerson && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current) => Math.max(0, Math.min(suggestions.length - 1, current + step)));
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        pick(activePerson);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'ArrowUp' && !editing && !event.altKey && text === '') {
      event.preventDefault();
      onEditLast();
    } else if (event.key === 'Escape' && editing) {
      event.preventDefault();
      onCancelEdit();
    }
  };

  const message = problem ?? error;
  return (
    <form
      className="shrink-0 border-t border-border p-3"
      data-testid="messages-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {editing && (
        <div className="mb-2 flex items-center justify-between gap-2 text-small text-muted">
          <span>
            Editing message · <Kbd>Esc</Kbd> to cancel
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit}>
            Cancel
          </Button>
        </div>
      )}
      <div className="relative flex items-end gap-2">
        {activePerson && (
          <ul
            id={listId}
            role="listbox"
            aria-label="People to mention"
            className="absolute bottom-full left-0 mb-1 flex max-h-60 w-64 flex-col gap-1 overflow-y-auto rounded border border-border bg-bg p-1 shadow-menu"
            data-testid="messages-mention-list"
          >
            {suggestions.map((person) => (
              <li
                key={person.id}
                id={optionId(person)}
                role="option"
                tabIndex={-1}
                aria-selected={person === activePerson}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-fill-hover',
                  person === activePerson && 'bg-fill-hover',
                )}
                // Mouse down keeps the focus in the composer.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(person);
                }}
              >
                <Avatar name={person.name} size="sm" decorative />
                <span className="truncate">{person.name}</span>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          ref={inputRef}
          value={text}
          rows={1}
          aria-label={label}
          placeholder={label}
          aria-describedby={measure.showCounter ? counterId : undefined}
          aria-invalid={measure.tooLong || undefined}
          aria-autocomplete="list"
          aria-controls={activePerson ? listId : undefined}
          aria-activedescendant={activePerson ? optionId(activePerson) : undefined}
          className="max-h-40 resize-none"
          data-testid="messages-composer-input"
          onChange={(event) => {
            change(event.target.value);
            watchCaret(event.target);
          }}
          onSelect={(event) => watchCaret(event.currentTarget)}
          onBlur={() => setMention(null)}
          onKeyDown={onKeyDown}
        />
        {editing ? (
          <Button
            type="submit"
            size="sm"
            loading={saving}
            disabled={measure.tooLong}
            data-testid="messages-save-edit"
          >
            Save
          </Button>
        ) : (
          <IconButton
            type="submit"
            label="Send"
            variant="primary"
            disabled={measure.blank || measure.tooLong}
            data-testid="messages-send"
          >
            <SendHorizontal className="size-4" aria-hidden />
          </IconButton>
        )}
      </div>
      {measure.showCounter && (
        <p
          id={counterId}
          className={cn('mt-1 text-small', measure.tooLong ? 'text-danger' : 'text-muted')}
        >
          {measure.remaining >= 0
            ? `${measure.remaining} characters left`
            : `${-measure.remaining} characters over the limit`}
        </p>
      )}
      {message && (
        <p role="alert" className="mt-1 text-small text-danger">
          {message}
        </p>
      )}
    </form>
  );
}
