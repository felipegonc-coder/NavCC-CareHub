import type { CalendarView } from '@carehub/team-time';
import { useEffect, useRef } from 'react';
import type { PeriodStep } from '../layout';

/** C, Delete, Esc and ?. The first three act on the screen, which says whether they apply. */
export type ShortcutAction = 'new-event' | 'delete' | 'close' | 'help';

/** What a single-key shortcut does (Calendar spec, section 6). */
export type CalendarShortcut =
  { view: CalendarView } | { step: PeriodStep } | { action: ShortcutAction };

const KEYS: Readonly<Record<string, CalendarShortcut>> = {
  t: { step: 'today' },
  d: { view: 'day' },
  w: { view: 'week' },
  m: { view: 'month' },
  j: { step: 'next' },
  ArrowRight: { step: 'next' },
  k: { step: 'previous' },
  ArrowLeft: { step: 'previous' },
  c: { action: 'new-event' },
  Delete: { action: 'delete' },
  // The delete key on Mac keyboards.
  Backspace: { action: 'delete' },
  Escape: { action: 'close' },
  '?': { action: 'help' },
};

/** The parts of a KeyboardEvent the shortcuts read. */
export interface ShortcutPress {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
  /** While an input method composes text, keys belong to the text. */
  isComposing?: boolean;
  /** A held key: only views and steps repeat, so holding C makes one event. */
  repeat?: boolean;
}

/** Roles of fields that take text, besides input, textarea, select and contenteditable. */
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

/** Dialogs on top of the calendar, and widgets whose keys are their own. */
const OWN_KEYS = [
  'dialog',
  'alertdialog',
  'menu',
  'menubar',
  'listbox',
  'tree',
  'tablist',
  'radiogroup',
  'slider',
]
  .map((role) => `[role="${role}"]`)
  .join(',');

interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selectors: string) => unknown;
}

/** True while the person types in a field, where letters are text, never shortcuts. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as TargetLike | null;
  if (!element) return false;
  return (
    element.isContentEditable === true ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? '') ||
    FIELD_ROLES.has(element.getAttribute?.('role') ?? '')
  );
}

/** True inside an open dialog, a menu, a list or another widget that uses the keys itself. */
export function ownsKeys(target: EventTarget | null): boolean {
  const element = target as TargetLike | null;
  return typeof element?.closest === 'function' && element.closest(OWN_KEYS) != null;
}

/**
 * The single-key shortcut a key press means, or null. None with Ctrl, Alt or Cmd, nor with Shift
 * (except ?, which takes Shift on most keyboards); none already handled, and none while typing in
 * a field or inside a dialog or widget with keys of its own.
 */
export function shortcutFor(press: ShortcutPress): CalendarShortcut | null {
  if (press.defaultPrevented || press.isComposing === true) return null;
  if (press.altKey || press.ctrlKey || press.metaKey) return null;
  const shortcut = KEYS[press.key.length === 1 ? press.key.toLowerCase() : press.key];
  if (shortcut === undefined || (press.shiftKey && press.key !== '?')) return null;
  if (press.repeat === true && 'action' in shortcut) return null;
  if (isTyping(press.target) || ownsKeys(press.target)) return null;
  return shortcut;
}

/**
 * Listens for the single-key shortcuts while `on` (Settings → Single-key shortcuts, on unless
 * turned off). `run` answers whether it used the key; only then is the browser's own action
 * stopped, so a key that doesn't apply (Delete with nothing selected) works as usual.
 */
export function useCalendarShortcuts(
  on: boolean,
  run: (shortcut: CalendarShortcut) => boolean,
): void {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    if (!on) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event);
      if (shortcut !== null && latest.current(shortcut)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [on]);
}
