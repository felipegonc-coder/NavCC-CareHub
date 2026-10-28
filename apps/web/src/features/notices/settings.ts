// The person's notice settings (Settings → Notifications, spec 3.3): which kinds of notices reach
// their 🔔 Care Hub chat in this workspace. Settings shows the switches; only the person sees and
// changes theirs, and their other tabs follow.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api, type ApiError } from '../../lib/api';
import { useLiveEvent } from '../live';

/** The kinds a person can turn off, in Settings order. */
export const NOTICE_SETTING_KEYS = ['comments', 'edits', 'formResponses', 'automations'] as const;

export type NoticeSettingKey = (typeof NOTICE_SETTING_KEYS)[number];

/** On (true) or off for each kind. */
export type NoticeSettings = Record<NoticeSettingKey, boolean>;

export interface NoticeSettingInfo {
  key: NoticeSettingKey;
  label: string;
  hint?: string;
}

/** In order, for the switches. */
export const NOTICE_SETTINGS: readonly NoticeSettingInfo[] = [
  { key: 'comments', label: 'Comments on pages I follow' },
  { key: 'edits', label: 'Edits on pages I follow', hint: 'At most one summary per page per hour' },
  { key: 'formResponses', label: 'Form responses' },
  { key: 'automations', label: 'Automation messages' },
];

/** Shown as always on, without switches. */
export const ALWAYS_ON_NOTICES: readonly string[] = [
  'Mentions and replies',
  'Reminders and access requests',
];

/** Until the person changes something: every kind on. */
export const DEFAULT_NOTICE_SETTINGS: Readonly<NoticeSettings> = Object.freeze({
  comments: true,
  edits: true,
  formResponses: true,
  automations: true,
});

/** What the server sends the person's tabs after their notice settings change. */
export const NOTICE_SETTINGS_CHANGED = 'notice-settings-changed';

const SETTINGS_PATH = '/api/notices/settings';
// Apart from ['notices', …], so a new notice doesn't refetch the settings.
export const noticeSettingsKey = ['notice-settings'] as const;

/** The person's notice settings, refetched when they change in another tab and after a reconnect. */
export function useNoticeSettings(): UseQueryResult<NoticeSettings, ApiError> {
  const queryClient = useQueryClient();
  useLiveEvent(NOTICE_SETTINGS_CHANGED, () => {
    // A change on its way from this tab asks again when it's done.
    if (queryClient.isMutating({ mutationKey: noticeSettingsKey }) > 0) return;
    void queryClient.invalidateQueries({ queryKey: noticeSettingsKey });
  });
  return useQuery<NoticeSettings, ApiError>({
    queryKey: noticeSettingsKey,
    queryFn: async ({ signal }) =>
      (await api.get<{ settings: NoticeSettings }>(SETTINGS_PATH, { signal })).settings,
  });
}

interface ChangeContext {
  before: NoticeSettings | undefined;
}

/**
 * Changes some of the settings: on screen straight away, then on the server. If the server
 * refuses, the screen goes back to how it was and `isError` is set.
 */
export function useChangeNoticeSettings(): UseMutationResult<
  NoticeSettings,
  ApiError,
  Partial<NoticeSettings>,
  ChangeContext
> {
  const queryClient = useQueryClient();
  return useMutation<NoticeSettings, ApiError, Partial<NoticeSettings>, ChangeContext>({
    mutationKey: noticeSettingsKey,
    mutationFn: async (change) =>
      (await api.patch<{ settings: NoticeSettings }>(SETTINGS_PATH, change)).settings,
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: noticeSettingsKey });
      const before = queryClient.getQueryData<NoticeSettings>(noticeSettingsKey);
      queryClient.setQueryData<NoticeSettings>(noticeSettingsKey, (settings) => ({
        ...DEFAULT_NOTICE_SETTINGS,
        ...settings,
        ...change,
      }));
      return { before };
    },
    onError: (_error, _change, context) => {
      if (context?.before) queryClient.setQueryData(noticeSettingsKey, context.before);
    },
    onSettled: () => {
      // Only the last of several quick changes asks again, so the switches don't flicker back.
      if (queryClient.isMutating({ mutationKey: noticeSettingsKey }) === 1) {
        void queryClient.invalidateQueries({ queryKey: noticeSettingsKey });
      }
    },
  });
}
