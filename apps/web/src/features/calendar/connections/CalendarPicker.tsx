import type { Connection } from '@carehub/team-calendar-api';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
} from '@carehub/ui';
import { useState } from 'react';
import { Swatch } from './ConnectionItem';
import { useUpdateConnection } from './data';

type PickerProps = { connection: Connection; onDone: () => void };

/** Right after signing in with Google: which of the account's calendars show in Care Hub. */
export function CalendarPicker({ connection, onDone }: PickerProps) {
  const update = useUpdateConnection();
  const [shown, setShown] = useState(
    () => new Set(connection.calendars.filter((item) => item.shown).map((item) => item.id)),
  );

  function pick(id: string, on: boolean) {
    setShown((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function save() {
    const calendars = connection.calendars
      .filter((item) => item.shown !== shown.has(item.id))
      .map((item) => ({ id: item.id, shown: shown.has(item.id) }));
    if (calendars.length === 0) return onDone();
    update.mutate({ id: connection.id, patch: { calendars } }, { onSuccess: onDone });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Google Calendar is connected</DialogTitle>
          <DialogDescription>
            Pick the calendars to show in Care Hub
            {connection.account ? ` from ${connection.account}` : ''}. You can change this here at
            any time.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {connection.calendars.map((calendar) => (
            <Field
              key={calendar.id}
              layout="inline"
              label={
                <span className="flex items-center gap-2">
                  <Swatch color={calendar.color} />
                  {calendar.name}
                </span>
              }
            >
              <Checkbox
                checked={shown.has(calendar.id)}
                onCheckedChange={(checked) => pick(calendar.id, checked === true)}
              />
            </Field>
          ))}
        </div>
        {update.error && (
          <p role="alert" className="text-small text-danger">
            {update.error.message}
          </p>
        )}
        <DialogFooter>
          <Button loading={update.isPending} onClick={save}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
