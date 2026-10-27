// Notifications in this browser, for Settings → Notifications and for Messages' "Get notified
// about new messages? Turn on · Not now".
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { notificationKeys, notificationsClient, type NotificationsClient } from './api';
import {
  PUSH_PROBLEM_TEXT,
  pushStatus,
  turnOffPush,
  turnOnPush,
  type PushResult,
  type PushStatus,
} from './push-client';
import { TEXT } from './text';

/** Push in this browser (push-client.ts); tests pass a stand-in. */
export interface BrowserPush {
  status(): Promise<PushStatus>;
  turnOn(): Promise<PushResult>;
  turnOff(): Promise<void>;
}

export const browserPush: BrowserPush = {
  status: () => pushStatus(),
  turnOn: () => turnOnPush(api),
  turnOff: () => turnOffPush(api),
};

export interface BrowserPushState {
  /** Undefined while it's being checked; 'server-off' while the server has no push keys. */
  status: PushStatus | 'server-off' | undefined;
  /** Whether the server can send push at all (undefined while checking). */
  serverReady: boolean | undefined;
  /** Why the last Turn on or Turn off didn't work, in words. */
  problem: string | null;
  changing: boolean;
  /** Call it straight from the click: browsers ask for permission only during one. */
  turnOn(): void;
  turnOff(): void;
}

export function useBrowserPush(
  push: BrowserPush = browserPush,
  client: Pick<NotificationsClient, 'pushIsSetUp'> = notificationsClient,
): BrowserPushState {
  const queryClient = useQueryClient();
  const browser = useQuery({
    queryKey: notificationKeys.browser,
    queryFn: () => push.status(),
    staleTime: Infinity,
    retry: false,
  });
  // When this can't be checked, Turn on still says if push isn't set up.
  const server = useQuery({
    queryKey: notificationKeys.server,
    queryFn: () => client.pushIsSetUp(),
    staleTime: Infinity,
  });
  const serverReady = server.isError ? true : server.data;
  const [changing, setChanging] = useState(false);
  const busy = useRef(false); // Also stops a second click before the next render.
  const [problem, setProblem] = useState<string | null>(null);

  function change(run: () => Promise<string | null>) {
    if (busy.current) return;
    busy.current = true;
    setChanging(true);
    setProblem(null);
    void run().then(async (failure) => {
      setProblem(failure);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: notificationKeys.browser }),
        queryClient.invalidateQueries({ queryKey: notificationKeys.devices }),
      ]);
      busy.current = false;
      setChanging(false);
    });
  }

  return {
    status: serverReady === false ? 'server-off' : browser.isError ? 'unsupported' : browser.data,
    serverReady,
    problem,
    changing,
    turnOn: () =>
      change(() =>
        push.turnOn().then(
          (result) => (result.ok ? null : PUSH_PROBLEM_TEXT[result.problem]),
          () => PUSH_PROBLEM_TEXT.failed,
        ),
      ),
    turnOff: () =>
      change(() =>
        push.turnOff().then(
          () => null,
          () => TEXT.turnOffFailed,
        ),
      ),
  };
}
