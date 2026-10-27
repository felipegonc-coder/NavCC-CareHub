import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { EditorSurface, tabbables } from './overlay';
import type { CellMove } from './types';

export interface EditorShellProps {
  label: string;
  /** Saves and closes, or shows why it can't. `move` comes from Tab or Shift+Tab. */
  commit: (move?: CellMove) => void;
  /** A press outside the editor (most editors save, or leave when the value can't be saved). */
  onOutside: () => void;
  onCancel: () => void;
  /** Enter on the panel itself (not on a field or button inside it). */
  onEnter?: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

/**
 * Keys every editor shares: Escape leaves without saving; Tab on the last field (Shift+Tab on the
 * first) saves and moves on, and the caller decides where. Fields handle their own Enter.
 */
export function EditorShell({
  label,
  commit,
  onOutside,
  onCancel,
  onEnter,
  initialFocus,
  className,
  children,
}: EditorShellProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Tab') {
      const all = tabbables(e.currentTarget);
      const edge = e.shiftKey ? all[0] : all.at(-1);
      if (edge && e.target !== edge && e.target !== e.currentTarget) return;
      e.preventDefault();
      commit(e.shiftKey ? 'previous' : 'next');
    } else if (e.key === 'Enter' && onEnter && e.target === e.currentTarget) {
      e.preventDefault();
      onEnter();
    }
  };
  return (
    <EditorSurface
      label={label}
      onOutside={onOutside}
      onKeyDown={onKeyDown}
      initialFocus={initialFocus}
      className={className}
    >
      {children}
    </EditorSurface>
  );
}
