// The Ask Claude menus and the Draft box (Claude features spec, sections 3.2 and 6): arrows move
// through a menu, Enter picks, → opens Change tone and ← goes back; in the Draft box Enter sends
// and Shift+Enter adds a line. Esc is the popover's: it closes everything.
import { Button, Field, Textarea } from '@carehub/ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

const itemClasses =
  'flex w-full cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-left text-small text-fg hover:bg-fill-hover focus-visible:bg-fill-hover focus-visible:outline-offset-inset max-md:min-h-11';

export interface Entry {
  id: string;
  label: string;
  hint?: string;
  /** Opens the tones. */
  opens?: boolean;
  pick: () => void;
}

/** A menu: arrows move, Enter picks, → opens Change tone and ← goes back. */
export function Menu({
  label,
  entries,
  onBack,
}: {
  label: string;
  entries: Entry[];
  onBack?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [label]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const focused = document.activeElement;
    const index = items.findIndex((item) => item === focused);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index < 0 ? -1 : index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'ArrowRight' && focused?.getAttribute('aria-haspopup') === 'menu') {
      event.preventDefault();
      (focused as HTMLElement).click();
    } else if (event.key === 'ArrowLeft' && onBack) {
      event.preventDefault();
      onBack();
    }
  };

  return (
    <div ref={ref} role="menu" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-haspopup={entry.opens ? 'menu' : undefined}
          aria-describedby={entry.hint ? `${id}-${entry.id}` : undefined}
          onClick={entry.pick}
          className={itemClasses}
        >
          <span className="min-w-0 flex-1">{entry.label}</span>
          {entry.hint && (
            <span id={`${id}-${entry.id}`} aria-hidden className="text-label text-muted">
              {entry.hint}
            </span>
          )}
          {entry.opens && (
            <span aria-hidden className="text-muted">
              ▸
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Draft: what Claude should write. Enter sends, Shift+Enter adds a line. */
export function DraftForm({
  problem,
  onSubmit,
  onBack,
}: {
  problem: string | null;
  onSubmit: (prompt: string) => void;
  onBack: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <form
      className="flex flex-col gap-3 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(prompt);
      }}
    >
      <Field label="What should Claude write?" error={problem ?? undefined}>
        <Textarea
          ref={box}
          value={prompt}
          rows={3}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit(prompt);
            }
          }}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Write
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  );
}
