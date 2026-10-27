import { CONNECTION_LIMITS, type Connection } from '@carehub/team-calendar-api';
import {
  Button,
  Checkbox,
  cn,
  colorClasses,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  isColorName,
} from '@carehub/ui';
import { formatDistanceToNow } from 'date-fns';
import { useId, useState } from 'react';
import { useRemoveConnection, useSyncConnection, useUpdateConnection } from './data';

const KINDS: Record<Connection['kind'], string> = {
  google: 'Google Calendar',
  'google-bridge': 'Google Calendar',
  icloud: 'iCloud Calendar',
  link: 'Calendar link',
};

export const TRUNCATED_NOTE = `Only the ${CONNECTION_LIMITS.eventsPerCalendar.toLocaleString('en-US')} events nearest to today show.`;

/** A design kit swatch for a calendar's colour. */
export function Swatch({ color }: { color: string }) {
  const name = isColorName(color) ? color : 'default';
  return <span aria-hidden className={cn('size-3 shrink-0 rounded-full', colorClasses[name].bg)} />;
}

type ItemProps = { connection: Connection; reconnect: () => void; reconnecting: boolean };

/** One connected account or link: its status, its calendars, Sync now, Reconnect and Remove. */
export function ConnectionItem({ connection, reconnect, reconnecting }: ItemProps) {
  const titleId = useId();
  const sync = useSyncConnection();
  const update = useUpdateConnection();
  const [removing, setRemoving] = useState(false);
  const problem = sync.error ?? update.error;
  const link = connection.kind === 'link' ? connection.calendars[0] : undefined;
  return (
    <li aria-labelledby={titleId} className="flex flex-col gap-3 rounded border border-border p-4">
      <div className="flex flex-col gap-0.5">
        <h2 id={titleId} className="flex items-center gap-2 text-h3">
          {link && <Swatch color={link.color} />}
          {connection.label}
        </h2>
        <p className="text-small text-muted">
          {KINDS[connection.kind]}
          {connection.account && ` · Connected as ${connection.account}`}
        </p>
        <Status connection={connection} />
        {link?.truncated && <p className="text-small text-muted">{TRUNCATED_NOTE}</p>}
      </div>
      {!link && connection.calendars.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-small font-medium">Calendars to show</legend>
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
              hint={calendar.truncated ? TRUNCATED_NOTE : undefined}
            >
              <Checkbox
                checked={calendar.shown}
                disabled={update.isPending}
                onCheckedChange={(checked) =>
                  update.mutate({
                    id: connection.id,
                    patch: { calendars: [{ id: calendar.id, shown: checked === true }] },
                  })
                }
              />
            </Field>
          ))}
        </fieldset>
      )}
      {problem && (
        <p role="alert" className="text-small text-danger">
          {problem.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {connection.status !== 'needs-reconnect' && (
          <Button
            variant="secondary"
            size="sm"
            loading={sync.isPending}
            onClick={() => sync.mutate(connection.id)}
          >
            {connection.status === 'error' ? 'Retry' : 'Sync now'}
          </Button>
        )}
        {connection.kind === 'google' && (
          <Button
            variant={connection.status === 'needs-reconnect' ? 'primary' : 'secondary'}
            size="sm"
            loading={reconnecting}
            onClick={reconnect}
          >
            Reconnect
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setRemoving(true)}>
          Remove
        </Button>
      </div>
      <RemoveDialog connection={connection} open={removing} onOpenChange={setRemoving} />
    </li>
  );
}

/** Up to date, or what went wrong, and when it last synced. */
function Status({ connection }: { connection: Connection }) {
  const { status, lastError, lastSyncedAt } = connection;
  const synced = lastSyncedAt
    ? `Last synced ${formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })}.`
    : 'Not synced yet.';
  if (status === 'ok') return <p className="text-small text-muted">Up to date. {synced}</p>;
  const why =
    lastError ??
    (status === 'needs-reconnect'
      ? 'Sign in again to keep it up to date.'
      : "The last sync didn't work.");
  return (
    <p className="text-small text-danger">
      {why} {synced}
    </p>
  );
}

type RemoveProps = { connection: Connection; open: boolean; onOpenChange: (open: boolean) => void };

/** Asks first: removing takes the calendars and their events out of Care Hub. */
function RemoveDialog({ connection, open, onOpenChange }: RemoveProps) {
  const remove = useRemoveConnection();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {connection.label}?</DialogTitle>
          <DialogDescription>
            Its calendars and their events leave Care Hub, and Care Hub forgets its sign-in or link.
            Nothing changes in the calendar itself.
          </DialogDescription>
        </DialogHeader>
        {remove.error && (
          <p role="alert" className="text-small text-danger">
            {remove.error.message}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate(connection.id)}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
