// Reminders' data: the person's next pending reminders, from `GET /api/reminders` (server:
// features/reminders). Stand-in: PendingReminder and usePendingReminders mirror what
// features/reminders exports on the web in #376 (W1-A). Switch to theirs once it's on main.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useLiveEvent } from '../live';

/** One pending (or snoozed) reminder. */
export interface PendingReminder {
  id: string;
  type: 'page' | 'event';
  /** Null when the person can't open the page or event. */
  title: string | null;
  /** ISO instant. */
  dueAt: string;
  /** '' when there's none. */
  note: string;
  /** Where Open goes: the page, or the event in Calendar. */
  href: string;
}

/** As the server lists it. `title` and `href` come with the reminders server's next PR (#209). */
interface ReminderView {
  id: string;
  target:
    | { type: 'page'; pageId: string }
    | { type: 'event'; eventId: string; occurrenceStart?: string | null };
  title?: string | null;
  href?: string;
  dueAt: string;
  note: string | null;
}

/** Until the server sends titles, a reminder says what it's for. */
const UNTITLED: Record<PendingReminder['type'], string> = { page: 'A page', event: 'An event' };

/** What the server sends the person's tabs after any change to their reminders. */
const REMINDERS_CHANGED = 'reminders-changed';
const pendingKey = ['reminders', 'pending'] as const;

/** The next `limit` pending reminders, soonest first, kept live. */
export function usePendingReminders(limit = 5) {
  const queryClient = useQueryClient();
  useLiveEvent(REMINDERS_CHANGED, () => {
    void queryClient.invalidateQueries({ queryKey: pendingKey });
  });
  return useQuery({
    queryKey: [...pendingKey, limit],
    queryFn: async ({ signal }) => {
      const { pending } = await api.get<{ pending: ReminderView[] }>('/api/reminders', { signal });
      return pending.slice(0, limit).map(toPendingReminder);
    },
  });
}

function toPendingReminder(view: ReminderView): PendingReminder {
  const { id, target, dueAt } = view;
  return {
    id,
    type: target.type,
    title: view.title === undefined ? UNTITLED[target.type] : view.title,
    dueAt,
    note: view.note ?? '',
    href: view.href ?? hrefOf(target),
  };
}

function hrefOf(target: ReminderView['target']): string {
  if (target.type === 'page') return `/p/${target.pageId}`;
  const search = new URLSearchParams({ event: target.eventId });
  if (target.occurrenceStart) search.set('occurrence', target.occurrenceStart);
  return `/calendar?${search.toString()}`;
}
