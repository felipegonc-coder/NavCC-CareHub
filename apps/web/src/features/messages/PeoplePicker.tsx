import { Check, X } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { PersonOptionJson } from '@carehub/team-chat';
import { Avatar, Button, cn, Input } from '@carehub/ui';
import { usePeopleOptions } from './data';
import { LoadError } from './LoadError';
import { foldText } from './mentions';

/** The list shows this many matches; typing narrows it. */
const SHOWN_MAX = 100;

/** Everyone whose name or job title has every word typed, ignoring case and accents. */
export function matchPeople(
  people: readonly PersonOptionJson[],
  query: string,
): PersonOptionJson[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  return people.filter((person) => {
    const text = foldText(`${person.name} ${person.jobTitle ?? ''}`);
    return words.every((word) => text.includes(word));
  });
}

interface PeoplePickerProps {
  picked: readonly PersonOptionJson[];
  onToggle(person: PersonOptionJson): void;
  /** No one else can be picked (groups have up to 50 people). */
  full: boolean;
  /** People already in the chat, who aren't offered. */
  hiddenIds?: ReadonlySet<string>;
}

/** Search people and pick several: a combobox over a list, with the picked people above it. */
export function PeoplePicker({ picked, onToggle, full, hiddenIds }: PeoplePickerProps) {
  const people = usePeopleOptions(true);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const everyone = people.data?.people;
  const offered = useMemo(
    () => (everyone ?? []).filter((person) => !hiddenIds?.has(person.id)),
    [everyone, hiddenIds],
  );
  const matches = useMemo(() => matchPeople(offered, query), [offered, query]);
  const shown = matches.slice(0, SHOWN_MAX);
  const isPicked = (person: PersonOptionJson) => picked.some((item) => item.id === person.id);

  const search = (value: string) => {
    setQuery(value);
    setActive(0);
  };
  const activePerson = shown[Math.min(active, shown.length - 1)];
  const optionId = (person: PersonOptionJson) => `${listId}-${person.id}`;

  // ↑ and ↓ move through the people, Enter picks one; Enter with nothing typed submits the form.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => Math.max(0, Math.min(shown.length - 1, current + step)));
    } else if (event.key === 'Enter' && query.trim() && activePerson) {
      event.preventDefault();
      onToggle(activePerson);
      search('');
    }
  };

  const nobody =
    everyone && matches.length === 0
      ? everyone.length === 0
        ? "There's no one else in this workspace yet."
        : offered.length === 0
          ? 'Everyone in this workspace is already here.'
          : 'No one matches.'
      : null;

  return (
    <>
      {picked.length > 0 && (
        <ul aria-label="Picked" className="flex flex-wrap gap-1">
          {picked.map((person) => (
            <li key={person.id}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={`Remove ${person.name}`}
                onClick={() => onToggle(person)}
              >
                {person.name}
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Input
        role="combobox"
        value={query}
        placeholder="Search people"
        aria-label="Search people"
        aria-expanded={shown.length > 0}
        aria-autocomplete="list"
        aria-controls={shown.length > 0 ? listId : undefined}
        aria-activedescendant={activePerson ? optionId(activePerson) : undefined}
        autoComplete="off"
        data-testid="messages-people-search"
        onChange={(event) => search(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="max-h-72 overflow-y-auto">
        {people.isPending && <p className="p-2 text-small text-muted">Loading people…</p>}
        {people.isError && (
          <LoadError message={people.error?.message ?? ''} onRetry={() => void people.refetch()} />
        )}
        {nobody && <p className="p-2 text-small text-muted">{nobody}</p>}
        {shown.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label="People"
            aria-multiselectable="true"
            className="flex flex-col gap-1"
          >
            {shown.map((person) => {
              const selected = isPicked(person);
              return (
                <li
                  key={person.id}
                  id={optionId(person)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  aria-disabled={!selected && full}
                  data-testid="messages-person-option"
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded px-2 py-1 hover:bg-fill-hover aria-disabled:opacity-50',
                    person === activePerson && 'bg-fill-hover',
                  )}
                  // Mouse down keeps the focus in the search box.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onToggle(person);
                  }}
                >
                  <Avatar
                    name={person.name}
                    src={person.avatarUrl ?? undefined}
                    size="sm"
                    decorative
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{person.name}</span>
                    {person.jobTitle && (
                      <span className="truncate text-small text-muted">{person.jobTitle}</span>
                    )}
                  </span>
                  {selected && <Check className="size-4 text-primary" aria-hidden />}
                </li>
              );
            })}
          </ul>
        )}
        {matches.length > shown.length && (
          <p className="p-2 text-small text-muted">Keep typing to find more people.</p>
        )}
      </div>
    </>
  );
}

/** The picked people, and toggling one, for a picker that holds at most `max`. */
export function usePicked(max: number) {
  const [picked, setPicked] = useState<PersonOptionJson[]>([]);
  const full = picked.length >= max;
  const toggle = (person: PersonOptionJson) => {
    setPicked((current) => {
      if (current.some((item) => item.id === person.id)) {
        return current.filter((item) => item.id !== person.id);
      }
      return current.length >= max ? current : [...current, person];
    });
  };
  return { picked, full, toggle };
}
