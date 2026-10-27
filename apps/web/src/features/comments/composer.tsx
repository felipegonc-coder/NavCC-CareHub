import { COMMENT_MAX_CHARS } from '@carehub/shared';
import { cn, IconButton, Textarea } from '@carehub/ui';
import { ArrowUp } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

/** The counter shows from here, as in Messages. */
const COUNT_FROM = 3800;

export interface ComposerProps {
  /** The box's accessible name, like "Reply" or "Edit comment". */
  label: string;
  placeholder?: string;
  initialText?: string;
  /** The send button's name (default "Send"). */
  submitLabel?: string;
  /** Moves focus into the box when it appears. */
  focusOnMount?: boolean;
  /**
   * Gets the text. The box empties at once (the thread shows the comment while it's sent),
   * unless this returns a promise: then the caller decides, as an edit does.
   */
  onSubmit(text: string): void | Promise<boolean>;
  /** Esc. */
  onCancel?(): void;
  /** ↑ in the empty box: edit your last comment. */
  onEditLast?(): void;
  /** The text box, for focusing it from outside. */
  boxRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}

/** A comment box. Enter sends and Shift+Enter starts a new line. */
export function Composer({
  label,
  placeholder,
  initialText = '',
  submitLabel = 'Send',
  focusOnMount = false,
  onSubmit,
  onCancel,
  onEditLast,
  boxRef,
  className,
}: ComposerProps) {
  const [text, setText] = useState(initialText);
  const ownBox = useRef<HTMLTextAreaElement>(null);
  const box = boxRef ?? ownBox;
  const counterId = useId();

  useEffect(() => {
    if (!focusOnMount) return;
    const element = box.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, [focusOnMount, box]);

  const length = Array.from(text.trim()).length;
  const tooLong = length > COMMENT_MAX_CHARS;
  const counting = length >= COUNT_FROM;

  const submit = () => {
    if (length === 0 || tooLong) return;
    if (onSubmit(text) === undefined) setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'ArrowUp' && text === '' && onEditLast) {
      event.preventDefault();
      onEditLast();
    }
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Textarea
          ref={box}
          aria-label={label}
          aria-describedby={counting ? counterId : undefined}
          aria-invalid={tooLong || undefined}
          placeholder={placeholder}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-9 resize-none"
        />
        <IconButton
          type="submit"
          label={submitLabel}
          variant="primary"
          size="sm"
          disabled={length === 0 || tooLong}
        >
          <ArrowUp aria-hidden />
        </IconButton>
      </form>
      {counting && (
        <p id={counterId} className={cn('text-label', tooLong ? 'text-danger' : 'text-muted')}>
          {tooLong
            ? 'A comment can be up to 4,000 characters.'
            : `${COMMENT_MAX_CHARS - length} characters left`}
        </p>
      )}
    </div>
  );
}
