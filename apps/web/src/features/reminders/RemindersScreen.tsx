import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  useToast,
  VisuallyHidden,
} from '@carehub/ui';
import { CalendarClock, FileText } from 'lucide-react';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { usePageTitle } from '../../lib/usePageTitle';
import type { Reminder } from './api';
import { EditReminderDialog } from './EditReminderDialog';
import { beforeLabel, formatWhen, reminderTitle, sentence, type TimeSettings } from './format';
import { useDeleteReminder, useReminderList, useTimePrefs } from './hooks';

/** When a reminder is (or was) due, in words. */
function whenLine(reminder: Reminder, prefs: TimeSettings): string {
  const when = (instant: string) => formatWhen(instant, prefs);
  switch (reminder.status) {
    case 'snoozed':
      return `Snoozed until ${when(reminder.dueAt)}`;
    case 'sent':
    case 'done': {
      const sent = `Sent ${when(reminder.sentAt ?? reminder.dueAt)}`;
      return reminder.status === 'done' ? `${sent} · Done` : sent;
    }
    default: {
      const due = sentence(when(reminder.dueAt));
      if (reminder.minutesBefore === null) return due;
      return `${due} · ${beforeLabel(reminder.minutesBefore, prefs)}`;
    }
  }
}

interface ItemProps {
  reminder: Reminder;
  prefs: TimeSettings;
  /** The Edit and Delete buttons, for pending reminders. */
  actions?: ReactNode;
}

function ReminderItem({ reminder, prefs, actions }: ItemProps) {
  const Icon = reminder.target.type === 'page' ? FileText : CalendarClock;
  const title = reminderTitle(reminder);
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {reminder.title === null ? (
          <p className="text-body text-muted">{title}</p>
        ) : (
          <Link to={reminder.href} className="text-body font-medium text-fg hover:underline">
            {title}
          </Link>
        )}
        <p className="text-small text-muted">
          <time dateTime={reminder.sentAt ?? reminder.dueAt}>{whenLine(reminder, prefs)}</time>
        </p>
        {reminder.note && (
          <p className="whitespace-pre-wrap break-words text-small text-fg">{reminder.note}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
    </li>
  );
}

interface SectionProps {
  id: string;
  title: string;
  empty: string;
  count: number;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}

function ReminderSection({ id, title, empty, count, headingRef, children }: SectionProps) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} ref={headingRef} tabIndex={-1} className="text-h3 focus:outline-none">
        {title}
      </h2>
      {count === 0 ? (
        <EmptyState message={empty} className="py-6" />
      ) : (
        <ul className="flex flex-col divide-y divide-border">{children}</ul>
      )}
    </section>
  );
}

/** Reminders (Home's See all): pending ones to change or delete, and the last 30 days' sent ones. */
export function RemindersScreen() {
  usePageTitle('Reminders');
  const list = useReminderList();
  const prefs = useTimePrefs();
  const remove = useDeleteReminder();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Reminder | null>(null);
  const pendingHeading = useRef<HTMLHeadingElement>(null);

  function deleteReminder(reminder: Reminder) {
    remove.mutate(reminder.id, {
      onSuccess: () => {
        pendingHeading.current?.focus();
        toast({ title: 'Reminder deleted', variant: 'success' });
      },
      onError: (error) =>
        toast({
          title: "Couldn't delete the reminder",
          description: error.message,
          variant: 'danger',
        }),
    });
  }

  let body: ReactNode;
  if (list.data) {
    const { pending, sent } = list.data;
    body = (
      <>
        <ReminderSection
          id="reminders-pending"
          title="Pending"
          empty="No reminders. Use Remind me on a page or event."
          count={pending.length}
          headingRef={pendingHeading}
        >
          {pending.map((reminder) => {
            const name = reminderTitle(reminder);
            return (
              <ReminderItem
                key={reminder.id}
                reminder={reminder}
                prefs={prefs}
                actions={
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(reminder)}>
                      Edit<VisuallyHidden> reminder: {name}</VisuallyHidden>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={remove.isPending && remove.variables === reminder.id}
                      onClick={() => deleteReminder(reminder)}
                    >
                      Delete<VisuallyHidden> reminder: {name}</VisuallyHidden>
                    </Button>
                  </>
                }
              />
            );
          })}
        </ReminderSection>
        <ReminderSection
          id="reminders-sent"
          title="Sent in the last 30 days"
          empty="No reminders sent in the last 30 days."
          count={sent.length}
        >
          {sent.map((reminder) => (
            <ReminderItem key={reminder.id} reminder={reminder} prefs={prefs} />
          ))}
        </ReminderSection>
      </>
    );
  } else if (list.isError) {
    body = (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    );
  } else {
    body = <LoadingState label="Loading reminders" />;
  }

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-8 px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-title">Reminders</h1>
      {body}
      {editing && (
        <EditReminderDialog reminder={editing} prefs={prefs} onClose={() => setEditing(null)} />
      )}
    </main>
  );
}
