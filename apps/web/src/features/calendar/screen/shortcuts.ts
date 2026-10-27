import type { CalendarView } from '@carehub/team-time';
import { useEffect, useRef } from 'react';
import type { PeriodStep } from '../layout';

export type Shortcut = { view: CalendarView } | { step: PeriodStep };

const KEYS: Record<string, Shortcut> = {
  t: { step: 'today' },
  d: { view: 'day' },
  w: { view: 'week' },
  m: { view: 'month' },
  j: { step: 'next' },
  ArrowRight: { step: 'next' },
  k: { step: 'previous' },
  ArrowLeft: { step: 'previous' },
};

type Press = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'defaultPrevented' | 'target'
>;

/** True while the person types in a field, where letters are text, never shortcuts. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  return (
    element?.isContentEditable === true ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '')
  );
}

/** The single-key shortcut a key press means: T, D, W, M, J or →, K or ←; none with a modifier. */
export function shortcutFor(press: Press): Shortcut | null {
  if (press.defaultPrevented || press.altKey || press.ctrlKey || press.metaKey || press.shiftKey) {
    return null;
  }
  if (isTyping(press.target)) return null;
  return KEYS[press.key.length === 1 ? press.key.toLowerCase() : press.key] ?? null;
}

/** Runs the calendar's single-key shortcuts while `on` (a Settings switch, on unless turned off). */
export function useShortcuts(on: boolean, run: (shortcut: Shortcut) => void): void {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    if (!on) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event);
      if (!shortcut) return;
      event.preventDefault();
      latest.current(shortcut);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [on]);
}
