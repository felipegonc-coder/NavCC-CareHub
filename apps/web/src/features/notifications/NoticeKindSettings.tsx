// Settings → Notifications: which kinds of notices reach the person's 🔔 Care Hub chat (Settings
// and members spec, 3.3). Notices owns the settings, their wording and the kinds that are always
// on; this group shows them and saves each switch as it changes.
import { Field, Switch } from '@carehub/ui';
import { useEffect, useId, useState } from 'react';
import {
  ALWAYS_ON_NOTICES,
  NOTICE_SETTINGS,
  useChangeNoticeSettings,
  useNoticeSettings,
  type NoticeSettingKey,
  type NoticeSettings,
} from '../notices';
import { GroupSkeleton, LoadError, SettingRow } from './parts';
import { TEXT } from './text';
import { useShowAfter } from './useShowAfter';

export function NoticeKindSettings() {
  const headingId = useId();
  const alwaysOnId = useId();
  const settings = useNoticeSettings();
  const change = useChangeNoticeSettings();
  const showSkeleton = useShowAfter(settings.isPending);
  // A new object each time, so a second save of the same switch restarts the 2 seconds.
  const [saved, setSaved] = useState<{ key: NoticeSettingKey } | null>(null);
  const [failed, setFailed] = useState<NoticeSettingKey | null>(null);

  useEffect(() => {
    if (!saved) return undefined;
    const timer = setTimeout(() => setSaved(null), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  // The switch moves at once; notices puts it back if the server refuses.
  const turn = (key: NoticeSettingKey, on: boolean) => {
    const changes: Partial<NoticeSettings> = {};
    changes[key] = on;
    setFailed(null);
    change.mutate(changes, {
      onSuccess: () => setSaved({ key }),
      onError: () => {
        setSaved(null);
        setFailed(key);
      },
    });
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-h3">
          {TEXT.notices}
        </h2>
        <p className="text-small text-muted">{TEXT.noticesHint}</p>
      </div>
      {settings.isPending ? (
        <GroupSkeleton shown={showSkeleton} />
      ) : settings.isError ? (
        <LoadError text={TEXT.noticesFailed} onRetry={() => void settings.refetch()} />
      ) : (
        <>
          {NOTICE_SETTINGS.map(({ key, label, hint }) => (
            <SettingRow key={key} saved={saved?.key === key}>
              <Field
                layout="inline"
                label={label}
                hint={hint}
                error={failed === key ? TEXT.notSaved(label) : undefined}
              >
                {/* Every kind is on until the person turns it off. */}
                <Switch
                  checked={settings.data[key] !== false}
                  onCheckedChange={(on) => turn(key, on)}
                />
              </Field>
            </SettingRow>
          ))}
          <div className="flex flex-col gap-1">
            <p id={alwaysOnId} className="text-small font-medium">
              {TEXT.alwaysOn}
            </p>
            <ul aria-labelledby={alwaysOnId} className="text-small text-muted">
              {ALWAYS_ON_NOTICES.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
