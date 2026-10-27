import { SendHorizontal } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type RefObject } from 'react';
import { measureMessageText } from '@carehub/team-chat';
import { Button, cn, IconButton, Kbd, Textarea } from '@carehub/ui';

/** What people were writing in each chat, kept while they move between chats. */
const drafts = new Map<string, string>();

interface ComposerProps {
  chatId: string;
  /** "Message Sam Ortiz". */
  label: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
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
  const measure = measureMessageText(text);

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
      <div className="flex items-end gap-2">
        <Textarea
          ref={inputRef}
          value={text}
          rows={1}
          aria-label={label}
          placeholder={label}
          aria-describedby={measure.showCounter ? counterId : undefined}
          aria-invalid={measure.tooLong || undefined}
          className="max-h-40 resize-none"
          data-testid="messages-composer-input"
          onChange={(event) => change(event.target.value)}
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
