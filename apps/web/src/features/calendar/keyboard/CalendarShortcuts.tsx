import { DEFAULT_SETTINGS } from '@carehub/team-calendar-api';
import type { CalendarView, CivilDateTime } from '@carehub/team-time';
import { useState } from 'react';
import { nextHalfHour, timedAt, type ItemTimes, type PeriodStep } from '../layout';
import { useCalendarShortcuts } from './shortcuts';
import { ShortcutsHelp } from './ShortcutsHelp';

export interface CalendarShortcutsProps {
  /** Settings → Single-key shortcuts, on unless turned off. Off, no single key does anything. */
  on: boolean;
  /** D, W and M. */
  onView: (view: CalendarView) => void;
  /** T, J or →, K or ←. */
  onStep: (step: PeriodStep) => void;
  /** Now in the person's time zone, for C. */
  now: CivilDateTime;
  /** Settings → Default event length, in minutes. */
  defaultLength?: number;
  /**
   * C: a new event at the next half hour, of the default length, with its title ready to type,
   * as when a slot is clicked. Leave out while the screen can't make events.
   */
  onNewEvent?: (times: ItemTimes) => void;
  /** Delete (or Backspace): ask to confirm, then delete. Only while an event is selected. */
  onDelete?: () => void;
  /** Esc: close the panel. Only while it's open. */
  onClose?: () => void;
}

/** Calendar's single-key shortcuts, and the list that ? opens. Renders that list only. */
export function CalendarShortcuts({
  on,
  onView,
  onStep,
  now,
  defaultLength = DEFAULT_SETTINGS.defaultLength,
  onNewEvent,
  onDelete,
  onClose,
}: CalendarShortcutsProps) {
  const [help, setHelp] = useState(false);
  useCalendarShortcuts(on, (shortcut) => {
    if ('view' in shortcut) {
      onView(shortcut.view);
      return true;
    }
    if ('step' in shortcut) {
      onStep(shortcut.step);
      return true;
    }
    const act = {
      'new-event': onNewEvent && (() => onNewEvent(timedAt(nextHalfHour(now), defaultLength))),
      delete: onDelete,
      close: onClose,
      help: () => setHelp(true),
    }[shortcut.action];
    act?.();
    return act !== undefined;
  });
  return <ShortcutsHelp open={help} onOpenChange={setHelp} on={on} />;
}
