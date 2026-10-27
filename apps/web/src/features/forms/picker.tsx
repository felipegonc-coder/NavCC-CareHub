import { useState, type KeyboardEvent } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@carehub/ui';
import { FloatingPanel } from './overlay';

export interface PickerOption {
  id: string;
  label: string;
}

export interface PickerProps {
  /** The text box's id, for the question's label. */
  id: string;
  /** The question's label, which names the text box and the list. */
  labelId: string;
  describedBy?: string | undefined;
  invalid: boolean;
  required: boolean;
  /** Several picks (multi-select, people, rows) or one. */
  multiple: boolean;
  selected: readonly PickerOption[];
  /** What to offer. Filtered by what's typed, unless onSearch looks it up instead. */
  options: readonly PickerOption[];
  onSearch?: (query: string) => void;
  /** A search is on its way. */
  searching?: boolean;
  onChange(next: PickerOption[]): void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onBlur?: () => void;
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * A searchable dropdown (combobox and listbox): selects with more than 7 options, multi-selects,
 * people and rows. Picks show as chips with a remove button; typing filters, arrows move, Enter
 * picks, Escape closes, Backspace in the empty box removes the last pick.
 */
export function Picker({
  id,
  labelId,
  describedBy,
  invalid,
  required,
  multiple,
  selected,
  options,
  onSearch,
  searching = false,
  onChange,
  onKeyDown,
  onBlur,
}: PickerProps) {
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = fold(query.trim());
  const shown = onSearch ? options : options.filter((o) => fold(o.label).includes(typed));
  const activeIndex = Math.min(active, shown.length - 1);
  const activeOption = open && activeIndex >= 0 ? shown[activeIndex] : undefined;
  const isPicked = (option: PickerOption) => selected.some((s) => s.id === option.id);

  function search(text: string) {
    setQuery(text);
    setActive(0);
    onSearch?.(text);
  }

  function pick(option: PickerOption) {
    if (!multiple) {
      onChange([option]);
      setOpen(false);
    } else if (isPicked(option)) {
      onChange(selected.filter((s) => s.id !== option.id));
    } else {
      onChange([...selected, option]);
    }
    if (query) search('');
  }

  function remove(option: PickerOption) {
    onChange(selected.filter((s) => s.id !== option.id));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const { key } = event;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
      } else {
        const step = key === 'ArrowDown' ? 1 : -1;
        setActive(Math.max(0, Math.min(activeIndex + step, shown.length - 1)));
      }
    } else if (key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (activeOption) pick(activeOption);
    } else if (key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    } else if (key === 'Backspace' && query === '') {
      const last = selected.at(-1);
      if (last) remove(last);
    } else {
      onKeyDown?.(event);
    }
  }

  return (
    <div className="relative flex flex-col gap-2">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {selected.map((option) => (
            <li
              key={option.id}
              className="inline-flex items-center gap-1 rounded bg-fill py-0.5 pl-2 pr-1 text-small text-fg"
            >
              <span>{option.label}</span>
              <button
                type="button"
                aria-label={`Remove ${option.label}`}
                onClick={() => remove(option)}
                className="rounded p-0.5 text-muted hover:bg-fill-hover hover:text-fg"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${id}-option-${activeIndex}` : undefined}
        placeholder="Search…"
        value={query}
        onChange={(event) => {
          search(event.target.value);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
        onKeyDown={handleKeyDown}
        className="flex h-9 w-full rounded border border-border bg-bg px-3 text-small text-fg transition-colors placeholder:text-faint hover:border-border-hover aria-[invalid=true]:border-danger"
      />
      {open && (
        <FloatingPanel>
          <ul id={listId} role="listbox" aria-labelledby={labelId} aria-multiselectable={multiple}>
            {shown.map((option, i) => (
              <li
                key={option.id}
                id={`${id}-option-${i}`}
                role="option"
                aria-selected={isPicked(option)}
                tabIndex={-1}
                onMouseDown={(event) => {
                  // Keep the focus in the text box.
                  event.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-small',
                  i === activeIndex && 'bg-fill-hover',
                )}
              >
                <Check
                  aria-hidden
                  className={cn('size-4 shrink-0 text-primary', !isPicked(option) && 'invisible')}
                />
                <span>{option.label}</span>
              </li>
            ))}
          </ul>
          {shown.length === 0 && (
            <p className="px-2 py-1.5 text-small text-muted">
              {searching ? 'Searching…' : 'No results'}
            </p>
          )}
        </FloatingPanel>
      )}
    </div>
  );
}
