import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Textarea,
  useToast,
} from '@carehub/ui';
import { useState, type FormEvent } from 'react';
import type { Reminder, ReminderChange } from './api';
import { fromInputs, reminderTitle, toInputs, type TimeSettings } from './format';
import { useChangeReminder } from './hooks';

const NOTE_MAX = 280;

interface Props {
  reminder: Reminder;
  prefs: TimeSettings;
  onClose: () => void;
  /** Where focus goes when the dialog closes. */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Change a pending reminder: a page reminder's date and time, and any reminder's note. (The time
 * before an event comes with Remind me on events.)
 */
export function EditReminderDialog({ reminder, prefs, onClose, onCloseAutoFocus }: Props) {
  const isPage = reminder.minutesBefore === null;
  const [initial] = useState(() => toInputs(reminder.dueAt, prefs.timeZone));
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [note, setNote] = useState(reminder.note);
  const [problem, setProblem] = useState<string | null>(null);
  const change = useChangeReminder();
  const { toast } = useToast();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (change.isPending) return;
    const result: ReminderChange = {};
    // Only a new date or time is sent, so an unchanged time keeps its seconds.
    if (isPage && (date !== initial.date || time !== initial.time)) {
      const at = fromInputs(date, time, prefs.timeZone);
      if (!at) {
        setProblem('Enter a date and a time.');
        return;
      }
      result.at = at;
    }
    if (note.trim() !== reminder.note) result.note = note.trim();
    if (Object.keys(result).length === 0) {
      onClose();
      return;
    }
    setProblem(null);
    change.mutate(
      { id: reminder.id, change: result },
      {
        onSuccess: () => {
          toast({ title: 'Reminder changed', variant: 'success' });
          onClose();
        },
        onError: (error) => setProblem(error.message),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Change reminder</DialogTitle>
          <DialogDescription>{reminderTitle(reminder)}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {isPage && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Time">
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Note" hint={`${note.length} of ${NOTE_MAX} characters`}>
            <Textarea
              rows={3}
              maxLength={NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {problem && (
            <p role="alert" className="text-small text-danger">
              {problem}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={change.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
