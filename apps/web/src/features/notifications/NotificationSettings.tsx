// Settings → Notifications (Settings and members spec, 3.3; Messages spec, "Unread and
// notifications"): what to be notified about, whether notifications show the text, pausing them,
// and push in this and the person's other browsers.
import {
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@carehub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import {
  NOTIFY_ABOUT,
  notificationKeys,
  notificationsClient,
  type NotificationPreferences,
  type NotificationsClient,
  type PreferenceChanges,
} from './api';
import { DeviceList, ThisBrowser } from './BrowserSettings';
import { GroupSkeleton, LoadError, SettingRow } from './parts';
import { PauseSettings } from './PauseSettings';
import { NOTIFY_ABOUT_LABEL, TEXT } from './text';
import { browserPush, useBrowserPush, type BrowserPush } from './useBrowserPush';
import { useShowAfter } from './useShowAfter';

type Setting = keyof PreferenceChanges;

export interface NotificationSettingsProps {
  /** Stand-ins for tests; the app uses the real server and browser. */
  client?: NotificationsClient;
  push?: BrowserPush;
}

export function NotificationSettings({
  client = notificationsClient,
  push = browserPush,
}: NotificationSettingsProps) {
  const browser = useBrowserPush(push, client);
  return (
    <div className="flex flex-col gap-8" data-testid="notifications-settings">
      <MessageSettings client={client} />
      <PauseSettings client={client} />
      <ThisBrowser {...browser} />
      <DeviceList client={client} canTest={browser.serverReady === true} />
    </div>
  );
}

function MessageSettings({ client }: { client: NotificationsClient }) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const preferences = useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: () => client.getPreferences(),
  });
  const showSkeleton = useShowAfter(preferences.isPending);
  // A new object each time, so a second save of the same setting restarts the 2 seconds.
  const [saved, setSaved] = useState<{ setting: Setting } | null>(null);
  const [failed, setFailed] = useState<Setting | null>(null);

  useEffect(() => {
    if (!saved) return undefined;
    const timer = setTimeout(() => setSaved(null), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const save = useMutation({
    mutationFn: (changes: PreferenceChanges) => client.updatePreferences(changes),
    // Shows the change at once and puts it back if it can't be saved.
    onMutate: async (changes) => {
      setFailed(null);
      await queryClient.cancelQueries({ queryKey: notificationKeys.preferences });
      const before = queryClient.getQueryData<NotificationPreferences>(
        notificationKeys.preferences,
      );
      if (before) queryClient.setQueryData(notificationKeys.preferences, { ...before, ...changes });
      return { before };
    },
    onError: (_error, changes, context) => {
      if (context?.before) queryClient.setQueryData(notificationKeys.preferences, context.before);
      setSaved(null);
      setFailed(settingOf(changes));
    },
    onSuccess: (answer, changes) => {
      queryClient.setQueryData(notificationKeys.preferences, answer);
      setSaved({ setting: settingOf(changes) });
    },
  });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-h3">
        {TEXT.messages}
      </h2>
      {preferences.isPending ? (
        <GroupSkeleton shown={showSkeleton} />
      ) : preferences.isError ? (
        <LoadError text={TEXT.settingsFailed} onRetry={() => void preferences.refetch()} />
      ) : (
        <>
          <SettingRow saved={saved?.setting === 'notifyAbout'}>
            <Field
              label={TEXT.notifyAbout}
              error={failed === 'notifyAbout' ? TEXT.notSaved(TEXT.notifyAbout) : undefined}
            >
              <Select
                value={preferences.data.notifyAbout}
                onValueChange={(value) => {
                  const notifyAbout = NOTIFY_ABOUT.find((option) => option === value);
                  if (notifyAbout) save.mutate({ notifyAbout });
                }}
              >
                <SelectTrigger className="md:w-96">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTIFY_ABOUT.map((option) => (
                    <SelectItem key={option} value={option}>
                      {NOTIFY_ABOUT_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </SettingRow>
          <SettingRow saved={saved?.setting === 'showText'}>
            <Field
              layout="inline"
              label={TEXT.showText}
              hint={TEXT.showTextHint}
              error={failed === 'showText' ? TEXT.notSaved(TEXT.showText) : undefined}
            >
              <Switch
                checked={preferences.data.showText}
                onCheckedChange={(showText) => save.mutate({ showText })}
              />
            </Field>
          </SettingRow>
        </>
      )}
    </section>
  );
}

function settingOf(changes: PreferenceChanges): Setting {
  return changes.notifyAbout === undefined ? 'showText' : 'notifyAbout';
}
