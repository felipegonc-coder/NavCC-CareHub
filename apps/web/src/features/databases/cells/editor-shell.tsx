import type { KeyboardEvent, ReactNode } from 'react';
import { EditorSurface } from './overlay';
import type { CellMove } from './types';

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.tabIndex >= 0);
}

export interface EditorShellProps {
  label: string;
  /** Saves and closes, or shows why it can't. `move` comes from Tab or Shift+Tab. */
  commit: (move?: CellMove) => void;
  /** A press outside the editor (most editors save, or leave when the value can't be saved). */
  onOutside: () => void;
  onCancel: () => void;
  /** Enter on the panel itself (not on a field or button inside it). */
  onEnter?: () => void;
  focusSelf?: boolean;
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
  focusSelf,
  className,
  children,
}: EditorShellProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Tab') {
      const all = tabbables(e.currentTarget);
      const edge = e.shiftKey ? all[0] : all.at(-1);
      if (edge && e.target !== edge && e.target !== e.currentTarget) return;
      e.preventDefault();
      e.stopPropagation();
      commit(e.shiftKey ? 'previous' : 'next');
    } else if (e.key === 'Enter' && onEnter && e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
      onEnter();
    }
  };
  return (
    <EditorSurface
      label={label}
      onOutside={onOutside}
      onKeyDown={onKeyDown}
      focusSelf={focusSelf}
      className={className}
    >
      {children}
    </EditorSurface>
  );
}
