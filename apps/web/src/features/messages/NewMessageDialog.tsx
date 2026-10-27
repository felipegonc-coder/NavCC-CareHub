import { Check, X } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { GROUP_MAX_PEOPLE, GROUP_NAME_MAX_LENGTH, type PersonOptionJson } from '@carehub/team-chat';
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@carehub/ui';
import { chatHref } from './chat-info';
import { usePeopleOptions, useStartChat } from './data';
import { LoadError } from './LoadError';

/** The list shows this many matches; typing narrows it. */
const SHOWN_MAX = 100;

/** Ignores case and accents: "jose" finds "José". */
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function matchPeople(
  people: readonly PersonOptionJson[],
  query: string,
): PersonOptionJson[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return people.filter((person) => {
    const text = fold(`${person.name} ${person.jobTitle ?? ''}`);
    return words.every((word) => text.includes(word));
  });
}

/** Pick people: one opens your direct chat with them, more start a group (or open the one you have). */
export function NewMessageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="messages-new-dialog">
        <NewMessageForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewMessageForm({ onDone }: { onDone(): void }) {
  const people = usePeopleOptions(true);
  const start = useStartChat();
  const navigate = useNavigate();
  const nameId = useId();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PersonOptionJson[]>([]);
  const [name, setName] = useState('');
  const [existingId, setExistingId] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  const group = picked.length > 1;
  // You're in the group too: 50 people in all.
  const full = picked.length >= GROUP_MAX_PEOPLE - 1;

  const everyone = people.data?.people;
  const matches = useMemo(() => matchPeople(everyone ?? [], query), [everyone, query]);
  const shown = matches.slice(0, SHOWN_MAX);

  const isPicked = (person: PersonOptionJson) => picked.some((item) => item.id === person.id);
  const toggle = (person: PersonOptionJson) => {
    if (!isPicked(person) && full) return;
    setExistingId(null);
    start.reset();
    setPicked((current) =>
      current.some((item) => item.id === person.id)
        ? current.filter((item) => item.id !== person.id)
        : [...current, person],
    );
  };
  const search = (value: string) => {
    setQuery(value);
    setActive(0);
  };
  const activePerson = shown[Math.min(active, shown.length - 1)];
  const optionId = (person: PersonOptionJson) => `${listId}-${person.id}`;

  // ↑ and ↓ move through the people, Enter picks one; Enter with nothing typed starts the chat.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => Math.max(0, Math.min(shown.length - 1, current + step)));
    } else if (event.key === 'Enter' && query.trim() && activePerson) {
      event.preventDefault();
      toggle(activePerson);
      search('');
    }
  };

  const openChat = (chatId: string) => {
    onDone();
    void navigate(chatHref(chatId));
  };

  const submit = (startNew: boolean) => {
    if (picked.length === 0) return;
    start.mutate(
      {
        userIds: picked.map((person) => person.id),
        name: group ? name.trim() || null : null,
        startNew,
      },
      {
        onSuccess: (answer) => {
          if (answer.existing && group && !startNew) setExistingId(answer.chatId);
          else openChat(answer.chatId);
        },
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New message</DialogTitle>
        <DialogDescription>
          Pick one person for a direct chat, or more to start a group.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(false);
        }}
      >
        {picked.length > 0 && (
          <ul aria-label="Picked" className="flex flex-wrap gap-1">
            {picked.map((person) => (
              <li key={person.id}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`Remove ${person.name}`}
                  onClick={() => toggle(person)}
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
            <LoadError
              message={people.error?.message ?? ''}
              onRetry={() => void people.refetch()}
            />
          )}
          {everyone && matches.length === 0 && (
            <p className="p-2 text-small text-muted">
              {everyone.length === 0
                ? "There's no one else in this workspace yet."
                : 'No one matches.'}
            </p>
          )}
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
                      toggle(person);
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
        {group && (
          <div className="flex flex-col gap-1">
            <label htmlFor={nameId} className="text-label">
              Group name (optional)
            </label>
            <Input
              id={nameId}
              value={name}
              maxLength={GROUP_NAME_MAX_LENGTH}
              data-testid="messages-group-name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        )}
        {start.error && (
          <p role="alert" className="text-small text-danger">
            {start.error.message}
          </p>
        )}
        {existingId ? (
          <>
            <p>You already have a group with these people.</p>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                loading={start.isPending}
                onClick={() => submit(true)}
              >
                Start new group
              </Button>
              <Button
                type="button"
                data-testid="messages-open-existing"
                onClick={() => openChat(existingId)}
              >
                Open existing chat
              </Button>
            </DialogFooter>
          </>
        ) : (
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={picked.length === 0}
              loading={start.isPending}
              data-testid="messages-start-chat"
            >
              {group ? 'Start group' : 'Open chat'}
            </Button>
          </DialogFooter>
        )}
      </form>
    </>
  );
}
