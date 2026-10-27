import { Link } from 'react-router';
import { HomeSection, rowClasses } from './HomeSection';
import { usePendingReminders, type PendingReminder } from './reminders';
import type { SectionProps } from './sections';
import { reminderDue } from './time';

const SHOWN = 5;

/** For a page or event the person can't open (any more), as the Reminders list says it. */
const LOCKED_TITLE: Record<PendingReminder['type'], string> = {
  page: "A page you can't open",
  event: "An event you can't open",
};

/** The next 5 pending reminders, soonest first, with See all for the full list. */
export function RemindersSection({ now, prefs }: SectionProps) {
  const query = usePendingReminders(SHOWN);
  return (
    <HomeSection
      title="Reminders"
      link={{ label: 'See all', to: '/reminders', hint: 'reminders' }}
      query={query}
      limit={SHOWN}
      empty="No reminders. Use Remind me on a page or event."
      noun="reminders"
      itemKey={(reminder) => reminder.id}
      renderItem={(reminder) => <ReminderRow reminder={reminder} now={now} prefs={prefs} />}
    />
  );
}

function ReminderRow({ reminder, now, prefs }: { reminder: PendingReminder } & SectionProps) {
  const { title, note } = reminder;
  const due = reminderDue(reminder.dueAt, now, prefs);
  return (
    <Link to={reminder.href} className={rowClasses}>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">
          {title === null ? LOCKED_TITLE[reminder.type] : title || '(No title)'}
        </span>{' '}
        <span className="truncate text-muted">{note ? `${due} · ${note}` : due}</span>
      </span>
    </Link>
  );
}
