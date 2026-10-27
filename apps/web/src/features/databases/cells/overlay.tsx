/**
 * Overlays for cells, in one place: an editor opens in the design kit's popover, over its cell.
 */
import { cn, Popover, PopoverAnchor, PopoverContent } from '@carehub/ui';
import {
  createContext,
  useContext,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';

/** The cell an editor opens over; null: the element it's rendered in (which must be positioned). */
export const EditorAnchor = createContext<Element | null>(null);

export interface EditorSurfaceProps {
  /** Read by screen readers: the property's name. */
  label: string;
  /** A press anywhere outside the panel. */
  onOutside: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /**
   * What gets focus when it opens (text fields get the cursor at the end); else the first thing
   * Tab reaches in it, or the panel.
   */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What Tab can reach inside an element, in order. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.tabIndex >= 0);
}

const isTextField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && ['text', 'search', 'url', 'email', 'tel'].includes(el.type));

// Keys and presses stay inside the editor: the table or board under it never sees them.
const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * The panel an editor or picker sits in, drawn over the cell. When it closes the caller puts focus
 * back where it wants (the cell, or the next one after Tab).
 */
export function EditorSurface({
  label,
  onOutside,
  onKeyDown,
  initialFocus,
  className,
  children,
}: EditorSurfaceProps) {
  const anchor = useContext(EditorAnchor);
  const panel = useRef<HTMLDivElement>(null);
  return (
    <Popover open>
      {anchor ? (
        <PopoverAnchor virtualRef={{ current: anchor }} />
      ) : (
        <PopoverAnchor className="pointer-events-none absolute inset-x-0 top-0" />
      )}
      <PopoverContent
        ref={panel}
        aria-label={label}
        side="bottom"
        align="start"
        sideOffset={0}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const root = panel.current;
          const el = initialFocus?.current ?? (root && (tabbables(root)[0] ?? root));
          el?.focus();
          if (el && isTextField(el)) el.setSelectionRange(el.value.length, el.value.length);
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onPointerDownOutside={() => onOutside()}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          e.stopPropagation();
        }}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={stop}
        onDoubleClick={stop}
        className={cn('flex w-72 min-w-0 max-w-dialog flex-col gap-1 p-1', className)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
