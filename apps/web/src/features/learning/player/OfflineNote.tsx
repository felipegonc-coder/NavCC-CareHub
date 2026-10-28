import { cn, useOnline } from '@carehub/ui';
import { CloudOff } from 'lucide-react';
import { useEffect, useState } from 'react';

/** How long events wait before the note shows while the browser says it's online. */
export const SLOW_SEND_MS = 5_000;

/** Whether `waiting` has stayed true for `ms`. */
function useWaitedFor(waiting: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  const [wasWaiting, setWasWaiting] = useState(waiting);
  if (waiting !== wasWaiting) {
    setWasWaiting(waiting);
    setLate(false);
  }
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [waiting, ms]);
  return waiting && late;
}

type OfflineNoteProps = {
  /** How many of the learner's events wait to be sent. */
  waiting: number;
  /** For the note itself, such as its border. */
  className?: string;
};

/**
 * Tells the learner their progress is safe while it can't be sent: when the browser is offline
 * (under the shell's offline banner, which says changes that need the server are paused), or when
 * events have waited a few seconds (Care Hub can't be reached). The status region is always there,
 * so screen readers read the note out when it shows.
 */
export function OfflineNote({ waiting, className }: OfflineNoteProps) {
  const online = useOnline();
  const late = useWaitedFor(waiting > 0, SLOW_SEND_MS);
  const show = waiting > 0 && (!online || late);
  return (
    <div role="status">
      {show && (
        <p className={cn('flex items-start gap-2 bg-fill px-4 py-2 text-small text-fg', className)}>
          <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
          <span className="min-w-0">
            Your progress is saved on this device. It will be sent when the connection is back.
          </span>
        </p>
      )}
    </div>
  );
}
