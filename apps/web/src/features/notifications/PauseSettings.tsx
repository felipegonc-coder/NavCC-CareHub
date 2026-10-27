// Settings → Notifications: "Pause notifications" (Settings and members spec, 3.3) for 1 hour,
// until tomorrow 8:00 AM, or until turned back on. Notices still arrive in the 🔔 chat, quietly.
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@carehub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import {
  notificationKeys,
  PAUSE_ENDS,
  type NotificationPreferences,
  type NotificationsClient,
  type PauseEnds,
} from './api';
import { PAUSE_ENDS_LABEL, pausedText, TEXT } from './text';

/** setTimeout's longest wait. */
const MAX_WAIT_MS = 2 ** 31 - 1;

/**
 * Shares the settings query with the Messages group, which shows loading and Retry, so this group
 * appears once the settings are in.
 */
export function PauseSettings({ client }: { client: NotificationsClient }) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const preferences = useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: () => client.getPreferences(),
  });
  const [failed, setFailed] = useState<string | null>(null);
  const saved = (answer: NotificationPreferences) =>
    queryClient.setQueryData(notificationKeys.preferences, answer);

  const pause = useMutation({
    mutationFn: (ends: PauseEnds) => client.pause(ends),
    onMutate: () => setFailed(null),
    onSuccess: saved,
    onError: () => setFailed(TEXT.pauseFailed),
  });
  const resume = useMutation({
    mutationFn: () => client.resume(),
    onMutate: () => setFailed(null),
    onSuccess: saved,
    onError: () => setFailed(TEXT.resumeFailed),
  });

  // When the pause ends, ask the server again, so the group shows notifications are back on.
  const until = preferences.data?.pause?.until;
  useEffect(() => {
    if (!until) return undefined;
    const wait = Math.min(Math.max(Date.parse(until) - Date.now(), 0), MAX_WAIT_MS);
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.preferences });
    }, wait);
    return () => clearTimeout(timer);
  }, [until, queryClient]);

  if (!preferences.data) return null;
  const paused = preferences.data.pause;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-h3">
        {TEXT.pause}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        {paused ? (
          <>
            <p className="text-small">{pausedText(paused.until, new Date())}</p>
            <Button variant="secondary" loading={resume.isPending} onClick={() => resume.mutate()}>
              {TEXT.turnBackOn}
            </Button>
          </>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" loading={pause.isPending}>
                {TEXT.pauseButton}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {PAUSE_ENDS.map((ends) => (
                <DropdownMenuItem key={ends} onSelect={() => pause.mutate(ends)}>
                  {PAUSE_ENDS_LABEL[ends]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="text-small text-muted">{TEXT.pauseHint}</p>
      <p role="alert" className="text-small text-danger">
        {failed ?? ''}
      </p>
    </section>
  );
}
