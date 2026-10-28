import { useState } from 'react';
import { isCalendarDate, type CalendarDate } from '@carehub/databases';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from '@carehub/ui';
import { CALENDAR_TEXT } from './messages';

export interface MoveToDateDialogProps {
  title: string;
  /** The day it starts on now (today for a row without a date). */
  initial: CalendarDate;
  onMove(date: CalendarDate): void;
  onClose(): void;
}

/** "Move to date": the keyboard's and phone's way to move a card to another day. */
export function MoveToDateDialog({ title, initial, onMove, onClose }: MoveToDateDialogProps) {
  const [date, setDate] = useState<string>(initial);
  const valid = isCalendarDate(date);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isCalendarDate(date)) onMove(date);
          }}
        >
          <DialogHeader>
            <DialogTitle>{CALENDAR_TEXT.moveToDate}</DialogTitle>
            <DialogDescription>{CALENDAR_TEXT.moveDescription(title)}</DialogDescription>
          </DialogHeader>
          <Field label={CALENDAR_TEXT.date}>
            <Input
              type="date"
              value={date}
              required
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {CALENDAR_TEXT.cancel}
            </Button>
            <Button type="submit" disabled={!valid}>
              {CALENDAR_TEXT.move}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
