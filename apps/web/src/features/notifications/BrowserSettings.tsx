// Settings → Notifications: push in this browser, and the person's browsers that get
// notifications (device, added, last used), with Remove and a test notification.
import { Button, useToast } from '@carehub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef } from 'react';
import { ApiError } from '../../lib/api';
import { notificationKeys, type NotificationsClient, type PushDevice } from './api';
import { GroupSkeleton, LoadError } from './parts';
import { PUSH_PROBLEM_TEXT } from './push-client';
import { formatDay, testResultToast, TEXT } from './text';
import type { BrowserPushState } from './useBrowserPush';
import { useShowAfter } from './useShowAfter';

/** Push in this browser: on, off, or why it can't be turned on here. */
export function ThisBrowser({ status, problem, changing, turnOn, turnOff }: BrowserPushState) {
  const headingId = useId();
  const showSkeleton = useShowAfter(status === undefined);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-h3">
        {TEXT.thisBrowser}
      </h2>
      {status === undefined ? (
        <GroupSkeleton shown={showSkeleton} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p aria-live="polite" className="text-small">
            {status === 'on'
              ? TEXT.browserOn
              : status === 'off'
                ? TEXT.browserOff
                : PUSH_PROBLEM_TEXT[status]}
          </p>
          {status === 'on' && (
            <Button variant="secondary" loading={changing} onClick={turnOff}>
              {TEXT.turnOff}
            </Button>
          )}
          {status === 'off' && (
            <Button loading={changing} onClick={turnOn}>
              {TEXT.turnOn}
            </Button>
          )}
        </div>
      )}
      <p role="status" className="text-small text-muted">
        {problem ?? ''}
      </p>
    </section>
  );
}

/** The person's browsers that get notifications, with Remove and a test notification. */
export function DeviceList({ client, canTest }: { client: NotificationsClient; canTest: boolean }) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const devices = useQuery({
    queryKey: notificationKeys.devices,
    queryFn: () => client.listDevices(),
  });
  const showSkeleton = useShowAfter(devices.isPending);
  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationKeys.devices });

  const remove = useMutation({
    mutationFn: (device: PushDevice) => client.removeDevice(device.id),
    // Its row goes away, so the focus moves to the heading.
    onSuccess: () => heading.current?.focus(),
    onError: (error, device) => {
      if (error instanceof ApiError && error.status === 404) heading.current?.focus();
      else toast({ title: TEXT.removeFailed(device.device), variant: 'danger' });
    },
    onSettled: refresh,
  });

  const test = useMutation({
    mutationFn: () => client.sendTest(),
    onSuccess: (result) => toast(testResultToast(result)),
    onError: (error) => {
      const wait = error instanceof ApiError && error.status === 429;
      toast({
        title: TEXT.testFailed,
        description: error.message,
        variant: wait ? 'default' : 'danger',
      });
    },
    onSettled: refresh, // Last used changes, and browsers that turned push off are gone.
  });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-h3">
        {TEXT.devices}
      </h2>
      <p className="text-small text-muted">{TEXT.devicesHint}</p>
      {devices.isPending ? (
        <GroupSkeleton shown={showSkeleton} />
      ) : devices.isError ? (
        <LoadError text={TEXT.devicesFailed} onRetry={() => void devices.refetch()} />
      ) : devices.data.length === 0 ? (
        <p className="text-small">{TEXT.noDevices}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {devices.data.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-3"
                data-testid="notifications-device"
              >
                <div className="min-w-0">
                  <p className="text-small font-medium">{device.device}</p>
                  <p className="text-small text-muted">
                    {TEXT.deviceDates(formatDay(device.createdAt), formatDay(device.lastUsedAt))}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={TEXT.removeDevice(device.device)}
                  loading={remove.isPending && remove.variables?.id === device.id}
                  onClick={() => remove.mutate(device)}
                >
                  {TEXT.remove}
                </Button>
              </li>
            ))}
          </ul>
          {canTest && (
            <div>
              <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
                {TEXT.sendTest}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
