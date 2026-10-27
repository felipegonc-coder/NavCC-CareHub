/**
 * Stand-ins for the design kit's popover and dialog until they're on main: a panel that opens
 * under the toolbar, and a dialog over the page. Both take focus when they open and close on Esc;
 * the dialog keeps Tab inside it.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn, IconButton } from '@carehub/ui';

/** Goes on the area that counts as inside. */
export interface InsideProps {
  onPointerDownCapture(): void;
}

/**
 * While `active`, calls onOutside when a press lands outside the area given the returned props
 * (the same object every time). Presses in the area's React children count as inside, even ones
 * drawn elsewhere (portals).
 */
export function useOutsidePress(active: boolean, onOutside: () => void): InsideProps {
  const inside = useRef(false);
  const latest = useRef(onOutside);
  useLayoutEffect(() => {
    latest.current = onOutside;
  });
  useEffect(() => {
    if (!active) return;
    // The document's capture listener runs before the area's handler, its bubble listener after.
    const start = () => {
      inside.current = false;
    };
    const end = () => {
      if (!inside.current) latest.current();
    };
    document.addEventListener('pointerdown', start, true);
    document.addEventListener('pointerdown', end);
    return () => {
      document.removeEventListener('pointerdown', start, true);
      document.removeEventListener('pointerdown', end);
    };
  }, [active]);
  return useMemo(
    () => ({
      onPointerDownCapture: () => {
        inside.current = true;
      },
    }),
    [],
  );
}

/** Moves focus into the box when it shows, unless something in it has focus already. */
function useTakeFocus(box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = box.current;
    if (element && !element.contains(document.activeElement)) element.focus();
  }, [box]);
}

/** Esc closes, unless something inside used it already (a list, a field). */
function closeOnEscape(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  event.stopPropagation();
  onClose();
}

export interface PopoverProps {
  /** Its name for screen readers. */
  label: string;
  /** Esc: the owner closes it and gives focus back. */
  onClose(): void;
  children?: ReactNode;
}

/**
 * A panel under the toolbar (role dialog, not modal), lined up with the right edge of the
 * `relative` box it's in. Its owner closes it on presses outside (useOutsidePress).
 */
export function Popover({ label, onClose, children }: PopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  useTakeFocus(box);
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => closeOnEscape(event, onClose)}
      className="absolute right-0 top-full z-20 mt-1 w-max max-w-full rounded border border-border bg-bg p-2 text-fg shadow-menu animate-pop-in focus:outline-none max-md:left-0 max-md:w-auto"
    >
      {children}
    </div>
  );
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Tab from the last control goes to the first, and Shift+Tab from the first to the last. */
function keepTabInside(event: KeyboardEvent<HTMLElement>) {
  const box = event.currentTarget;
  const controls = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const focused = document.activeElement;
  if (event.shiftKey && (focused === first || focused === box)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && focused === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface DialogProps {
  title: string;
  /** Close and Esc. */
  onClose(): void;
  children?: ReactNode;
}

/** A dialog over the page (role dialog, modal) with its title and Close. */
export function Dialog({ title, onClose, children }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useTakeFocus(box);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 md:items-center">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Tab') keepTabInside(event);
          else closeOnEscape(event, onClose);
        }}
        className={cn(
          'flex w-full max-w-2xl flex-col gap-3 rounded border border-border bg-bg p-4 text-fg',
          'shadow-dialog animate-pop-in focus:outline-none',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-body font-semibold">
            {title}
          </h2>
          <IconButton label="Close" size="sm" className="max-md:size-11" onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
