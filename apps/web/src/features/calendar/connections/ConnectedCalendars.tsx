import { CONNECTION_LIMITS, connectProblemMessage } from '@carehub/team-calendar-api';
import { Button } from '@carehub/ui';
import { useId, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarPicker } from './CalendarPicker';
import { ConnectionItem } from './ConnectionItem';
import { useConnectGoogle, useConnections } from './data';
import { LinkDialog } from './LinkDialog';

export const LIMIT_MESSAGE = `You can connect up to ${CONNECTION_LIMITS.connections} calendars. Remove one to add another.`;

/**
 * Connected calendars (Calendar spec, Connections): connect Google Calendar or a private calendar
 * link, then see each one's status and when it last synced, with Reconnect and Remove. Care Hub
 * only reads these calendars.
 */
export function ConnectedCalendars() {
  const connections = useConnections();
  const google = useConnectGoogle();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const limitId = useId();
  // Where Google's sign-in comes back to: `?connected=<id>`, or `?problem=<code>`.
  const problem = params.get('problem');
  const connectedId = params.get('connected');
  const forget = (name: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(name);
        return next;
      },
      { replace: true },
    );

  if (!connections.data) {
    if (!connections.error) return <p className="text-body text-muted">Loading your calendars…</p>;
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-body">
          Your connected calendars didn't load. {connections.error.message}
        </p>
        <Button variant="secondary" onClick={() => void connections.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const { connections: list, unavailable } = connections.data;
  const full = list.length >= CONNECTION_LIMITS.connections;
  const connected = list.find((connection) => connection.id === connectedId);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-muted">
        See your other calendars next to Care Hub's. Care Hub only reads them and never changes
        anything in them.
      </p>
      {problem && (
        <Problem onDismiss={() => forget('problem')}>{connectProblemMessage(problem)}</Problem>
      )}
      {google.error && <Problem onDismiss={google.reset}>{google.error.message}</Problem>}
      {full && (
        <p id={limitId} className="text-small text-muted">
          {LIMIT_MESSAGE}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <Way
          reason={unavailable.google}
          limitId={full ? limitId : undefined}
          loading={google.isPending && !google.variables}
          onClick={() => google.mutate(undefined)}
        >
          Connect Google Calendar
        </Way>
        <Way
          reason={unavailable.links}
          limitId={full ? limitId : undefined}
          variant="secondary"
          onClick={() => setAdding(true)}
        >
          Add a calendar link
        </Way>
      </div>
      {list.length === 0 ? (
        <p className="text-body text-muted">No connected calendars yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((connection) => (
            <ConnectionItem
              key={connection.id}
              connection={connection}
              reconnect={() => google.mutate(connection.id)}
              reconnecting={google.isPending && google.variables === connection.id}
            />
          ))}
        </ul>
      )}
      <LinkDialog open={adding} onOpenChange={setAdding} />
      {connected && connected.kind !== 'link' && (
        <CalendarPicker connection={connected} onDone={() => forget('connected')} />
      )}
    </div>
  );
}

type WayProps = {
  /** Why this server can't offer it, or null. */
  reason: string | null;
  /** The limit message's id, when the person already has as many connections as they can. */
  limitId: string | undefined;
  variant?: 'secondary';
  loading?: boolean;
  onClick: () => void;
  children: ReactNode;
};

/** A way to connect, switched off with its reason when it can't be used. */
function Way({ reason, limitId, ...button }: WayProps) {
  const id = useId();
  return (
    <div className="flex max-w-sm flex-col gap-1">
      <Button
        {...button}
        disabled={reason !== null || limitId !== undefined}
        aria-describedby={reason ? id : limitId}
      />
      {reason && (
        <p id={id} className="text-small text-muted">
          {reason}
        </p>
      )}
    </div>
  );
}

function Problem({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded border border-danger px-4 py-3"
    >
      <p className="text-body">{children}</p>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
