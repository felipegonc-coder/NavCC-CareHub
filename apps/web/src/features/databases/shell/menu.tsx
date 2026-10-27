/**
 * A stand-in for the design kit's menu until it's on main: a button that opens a list of actions
 * (role menu). ↑ and ↓, Home and End move between items; Enter or Space picks one; Esc closes and
 * gives focus back to the button; Tab or a press outside closes it.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { buttonClasses, cn } from '@carehub/ui';
import { useOutsidePress } from './overlay';
import { TOUCH } from './states';

export interface MenuItem {
  id: string;
  label: string;
  onSelect(): void;
  /** An on/off setting (role menuitemcheckbox), ticked when on. */
  checked?: boolean;
  /** Deletes something: drawn in the danger colour. */
  danger?: boolean;
}

export interface MenuProps {
  /** The menu's name, and the button's when it shows an icon. */
  label: string;
  items: readonly MenuItem[];
  /** The button shows this icon instead of the label. */
  icon?: ReactNode;
}

const ITEM = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-small outline-none';

export function Menu({ label, items, icon }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<'first' | 'last'>('first');
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const inside = useOutsidePress(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const all = menuItems(list.current);
    (from === 'last' ? all[all.length - 1] : all[0])?.focus();
  }, [open, from]);

  const show = (start: 'first' | 'last') => {
    setFrom(start);
    setOpen(true);
  };

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    show(event.key === 'ArrowUp' ? 'last' : 'first');
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = menuItems(list.current);
    const at = all.findIndex((item) => item === document.activeElement);
    const go = (index: number) => {
      event.preventDefault();
      all[(index + all.length) % all.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(all.length - 1);
    else if (event.key === 'Tab') close(false);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  const pick = (item: MenuItem) => {
    close(true);
    item.onSelect();
  };

  return (
    <div className="relative" {...inside}>
      <button
        ref={button}
        type="button"
        aria-label={icon ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={buttonClasses({
          variant: 'ghost',
          size: 'sm',
          icon: icon !== undefined,
          className: icon ? 'max-md:size-11' : TOUCH,
        })}
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={onButtonKeyDown}
      >
        {icon ?? label}
      </button>
      {open && (
        <div
          ref={list}
          id={listId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute right-0 top-full z-30 mt-1 flex min-w-48 flex-col rounded border border-border bg-bg p-1 text-fg shadow-menu animate-pop-in"
        >
          {items.map((item) => {
            const look = cn(
              ITEM,
              TOUCH,
              'hover:bg-fill-hover focus:bg-fill-hover',
              item.danger ? 'text-danger' : 'text-fg',
            );
            return item.checked === undefined ? (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={look}
                onClick={() => pick(item)}
              >
                {item.label}
              </button>
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={item.checked}
                tabIndex={-1}
                className={look}
                onClick={() => pick(item)}
              >
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.checked && <Check aria-hidden="true" className="size-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The items of an open menu, in order. */
function menuItems(list: HTMLElement | null): HTMLElement[] {
  return list ? Array.from(list.querySelectorAll<HTMLElement>('[role^="menuitem"]')) : [];
}
