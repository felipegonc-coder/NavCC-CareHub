import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AddButton, ListControls, moveTo } from './ListControls';

export type ItemListProps<T extends { id: string }> = {
  items: readonly T[];
  onChange(next: T[]): void;
  /** One item, capitalised: "Section" gives "Section 2", "Move section 2 up" and "Add a section". */
  noun: string;
  max: number;
  /** The list can't get shorter than this. */
  min?: number;
  newItem(): NoInfer<T>;
  /** The fields of one item; `update` changes some of them (a field set to undefined is left out). */
  children(item: T, update: (patch: Partial<T>) => void, index: number): ReactNode;
};

/** Where focus goes after a change, so it isn't lost: the moved item's button, a new item, or Add. */
type Focus = { id: string; to: 'up' | 'down' | 'field' } | { to: 'add' };

/** An editor's list of items, each in a numbered box with move and remove buttons, then "Add a …". */
export function ItemList<T extends { id: string }>({
  items,
  onChange,
  noun,
  max,
  min = 0,
  newItem,
  children,
}: ItemListProps<T>) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const focus = useRef<Focus | undefined>(undefined);
  const lower = noun.toLowerCase();

  useEffect(() => {
    const next = focus.current;
    focus.current = undefined;
    if (!next || !root.current) return;
    if (next.to === 'add') {
      root.current.querySelector<HTMLElement>('[data-add] button')?.focus();
      return;
    }
    const item = [...root.current.querySelectorAll<HTMLElement>('[data-item]')].find(
      (element) => element.dataset.item === next.id,
    );
    const buttons = [
      ...(item?.querySelectorAll<HTMLButtonElement>('[data-controls] button') ?? []),
    ];
    const target =
      next.to === 'field'
        ? item?.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]')
        : [buttons[next.to === 'up' ? 0 : 1], ...buttons].find(
            (button) => button && !button.disabled,
          );
    target?.focus();
  });

  const update = (id: string, patch: Partial<T>) =>
    onChange(
      items.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        for (const key of Object.keys(patch) as (keyof T)[])
          if (patch[key] === undefined) delete next[key];
        return next;
      }),
    );

  return (
    <div ref={root} className="flex flex-col gap-3">
      {items.length > 0 && (
        <ol className="flex flex-col gap-3">
          {items.map((item, index) => (
            <li key={item.id}>
              <div
                role="group"
                aria-labelledby={`${listId}-${index}`}
                data-item={item.id}
                className="flex flex-col gap-3 rounded border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p id={`${listId}-${index}`} className="text-small font-medium text-fg">
                    {noun} {index + 1}
                  </p>
                  <div data-controls>
                    <ListControls
                      name={`${lower} ${index + 1}`}
                      index={index}
                      count={items.length}
                      canRemove={items.length > min}
                      onMove={(to) => {
                        focus.current = { id: item.id, to: to < index ? 'up' : 'down' };
                        onChange(moveTo(items, index, to));
                      }}
                      onRemove={() => {
                        focus.current = { to: 'add' };
                        onChange(items.filter((other) => other.id !== item.id));
                      }}
                    />
                  </div>
                </div>
                {children(item, (patch) => update(item.id, patch), index)}
              </div>
            </li>
          ))}
        </ol>
      )}
      <div data-add>
        <AddButton
          full={items.length >= max}
          max={max}
          onAdd={() => {
            const added = newItem();
            focus.current = { id: added.id, to: 'field' };
            onChange([...items, added]);
          }}
        >
          Add {/^[aeiou]/i.test(noun) ? 'an' : 'a'} {lower}
        </AddButton>
      </div>
    </div>
  );
}
