import type { SearchPeopleQuery } from '@carehub/extras/search';
import { cn, Input } from '@carehub/ui';
import { Check } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { usePagePicks, usePeople } from './data';
import { ChipPopover, rowClasses } from './Chip';
import { pickLabel, toggled, type Names } from './filters';
import { titleOf } from './ResultRow';

// The In, Created by and Edited by chips (spec 2): each lists what to pick as you type.

interface PickItem {
  id: string;
  name: string;
  /** Shown after the name, such as the page's path. */
  detail?: string;
}

/** A chip's list: a box to type in, then options to pick, more than one if needed. */
function PickList(props: {
  label: string;
  text: string;
  onText: (text: string) => void;
  items: PickItem[];
  picked: readonly string[];
  onPick: (item: PickItem) => void;
  hint: string;
}) {
  const { items, onPick } = props;
  const id = useId();
  const [active, setActive] = useState(0);
  const at = Math.max(0, Math.min(active, items.length - 1));
  const current = items[at];
  const optionId = (item: PickItem) => `${id}-${item.id}`;

  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
  });

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = at + (event.key === 'ArrowDown' ? 1 : -1);
      setActive(Math.max(0, Math.min(items.length - 1, next)));
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      onPick(current);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        role="combobox"
        aria-label={props.label}
        aria-expanded={items.length > 0}
        aria-controls={items.length > 0 ? `${id}-list` : undefined}
        aria-activedescendant={current ? optionId(current) : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={props.label}
        value={props.text}
        onChange={(event: { target: HTMLInputElement }) => {
          props.onText(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {items.length > 0 ? (
        <div
          role="listbox"
          id={`${id}-list`}
          aria-label={props.label}
          aria-multiselectable
          className="max-h-64 overflow-y-auto"
        >
          {items.map((item, index) => {
            const on = props.picked.includes(item.id);
            return (
              <div
                key={item.id}
                id={optionId(item)}
                role="option"
                aria-selected={on}
                aria-label={item.detail ? `${item.name}, ${item.detail}` : item.name}
                tabIndex={-1}
                className={cn(rowClasses, index === at && 'bg-fill-hover')}
                onMouseMove={() => index !== at && setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(item)}
                onKeyDown={(event) => event.key === 'Enter' && onPick(item)}
              >
                <Check
                  aria-hidden
                  className={cn('size-4 shrink-0 text-primary', !on && 'invisible')}
                />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.detail && (
                  <span className="min-w-0 max-w-32 truncate text-label text-muted">
                    {item.detail}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-2 py-1.5 text-small text-muted">{props.hint}</p>
      )}
    </div>
  );
}

/** The ones picked before, first, so they can be taken out again. */
function withPicked(ids: readonly string[], names: Names, found: PickItem[], unknown: string) {
  const missing = ids.filter((id) => !found.some((item) => item.id === id));
  return [...missing.map((id) => ({ id, name: names[id] ?? unknown })), ...found];
}

/** In: spaces or pages, each with everything under it. */
export function InChip(props: {
  ids: string[] | undefined;
  names: Names;
  onChange: (ids: string[], names: Names) => void;
}) {
  const ids = props.ids ?? [];
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  // stand-in: the spaces API (#49) adds spaces to this list.
  const found = usePagePicks(text, open);
  const items = withPicked(
    ids,
    props.names,
    (found.data?.results ?? []).map((result) => ({
      id: result.id,
      name: titleOf(result),
      ...(result.path.length > 0 && { detail: result.path.join(' › ') }),
    })),
    'A page picked before',
  );
  return (
    <ChipPopover
      chip="In"
      label={pickLabel('In', ids, props.names, ['page', 'pages'])}
      on={ids.length > 0}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setText('');
      }}
    >
      <PickList
        label="Find a page"
        text={text}
        onText={setText}
        items={items}
        picked={ids}
        onPick={(item) => props.onChange(toggled(ids, item.id), { [item.id]: item.name })}
        hint="Type the title of a page or database."
      />
    </ChipPopover>
  );
}

/** Created by and Edited by: people who made or last changed pages the person can open. */
export function PeopleChip(props: {
  field: SearchPeopleQuery['role'];
  ids: string[] | undefined;
  names: Names;
  onChange: (ids: string[], names: Names) => void;
}) {
  const ids = props.ids ?? [];
  const chip = props.field === 'created' ? 'Created by' : 'Edited by';
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const people = usePeople(props.field, text, open);
  const items = withPicked(ids, props.names, people.data?.people ?? [], 'Someone picked before');
  return (
    <ChipPopover
      chip={chip}
      label={pickLabel(chip, ids, props.names, ['person', 'people'])}
      on={ids.length > 0}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setText('');
      }}
    >
      <PickList
        label="Find a person"
        text={text}
        onText={setText}
        items={items}
        picked={ids}
        onPick={(item) => props.onChange(toggled(ids, item.id), { [item.id]: item.name })}
        hint={people.isFetching ? 'Loading…' : 'Nobody found.'}
      />
    </ChipPopover>
  );
}
