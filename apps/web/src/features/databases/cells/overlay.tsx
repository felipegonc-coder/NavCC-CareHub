/**
 * Overlays for cells, in one place: the design kit's menus, popovers and dialogs arrive with
 * PR #27 (feat/design-kit-overlays); when they're on main only this file changes.
 */
import { cn } from '@carehub/ui';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

const SURFACE =
  'z-50 flex min-w-0 flex-col gap-1 rounded border border-border bg-bg p-1 text-fg shadow-menu animate-pop-in focus:outline-none';

export interface EditorSurfaceProps {
  /** Read by screen readers: the property's name. */
  label: string;
  /** A press anywhere outside the panel. */
  onOutside: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** Focus the panel itself (editors with nothing to type into). */
  focusSelf?: boolean;
  className?: string;
  children: ReactNode;
}

/** The panel an editor or picker sits in. The caller places it over or under the cell. */
export function EditorSurface({
  label,
  onOutside,
  onKeyDown,
  focusSelf = false,
  className,
  children,
}: EditorSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const outside = useRef(onOutside);
  useEffect(() => {
    outside.current = onOutside;
  });
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) outside.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);
  useEffect(() => {
    if (focusSelf) ref.current?.focus();
  }, [focusSelf]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(SURFACE, className)}
    >
      {children}
    </div>
  );
}
