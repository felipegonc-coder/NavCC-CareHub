// The person's Home settings, from the server's features/home: the sections they hid with
// Customize Home, and whether the sidebar's Upcoming is folded. Only theirs (HR-06), and kept in
// step across their tabs.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useLiveEvent } from '../live';

/** Every section's ID, in the spec's order: the same list as the server's. */
export const HOME_SECTION_IDS = [
  'upcoming',
  'unread',
  'tasks',
  'reminders',
  'learning',
  'recent',
] as const;

export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

/** As the server sends it (apps/server/src/features/home/types.ts). */
export interface HomeSettings {
  /** Hidden with Customize Home, each once, in Home's order. */
  hiddenSections: HomeSectionId[];
  /** Whether the sidebar's Upcoming heading is folded. */
  upcomingFolded: boolean;
}

/** Some of the settings; the others stay as they are. */
export type HomeSettingsChange = Partial<HomeSettings>;

/** Until the person changes something, and while their settings can't be loaded. */
export const DEFAULT_HOME_SETTINGS: Readonly<HomeSettings> = Object.freeze({
  hiddenSections: [],
  upcomingFolded: false,
});

/** What the server sends the person's tabs after their settings change. */
export const HOME_SETTINGS_CHANGED = 'home-settings-changed';

const SETTINGS_PATH = '/api/home/settings';
export const homeSettingsKey = ['home', 'settings'] as const;

/** The person's settings, refetched when they change in another tab and after a reconnect. */
export function useHomeSettings() {
  const queryClient = useQueryClient();
  useLiveEvent(HOME_SETTINGS_CHANGED, () => {
    // A change on its way from this tab asks again when it's done.
    if (queryClient.isMutating({ mutationKey: homeSettingsKey }) > 0) return;
    void queryClient.invalidateQueries({ queryKey: homeSettingsKey });
  });
  return useQuery({
    queryKey: homeSettingsKey,
    queryFn: async ({ signal }) =>
      (await api.get<{ settings: HomeSettings }>(SETTINGS_PATH, { signal })).settings,
  });
}

/**
 * Changes the settings on screen straight away, then on the server. If that fails, the screen goes
 * back to how it was, and `isError` is set.
 */
export function useChangeHomeSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: homeSettingsKey,
    mutationFn: async (change: HomeSettingsChange) =>
      (await api.patch<{ settings: HomeSettings }>(SETTINGS_PATH, change)).settings,
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: homeSettingsKey });
      const before = queryClient.getQueryData<HomeSettings>(homeSettingsKey);
      queryClient.setQueryData<HomeSettings>(homeSettingsKey, (settings) => ({
        ...DEFAULT_HOME_SETTINGS,
        ...settings,
        ...change,
      }));
      return { before };
    },
    onError: (_error, _change, context) => {
      if (context?.before) queryClient.setQueryData(homeSettingsKey, context.before);
    },
    onSettled: () => {
      // Only the last of several quick changes asks again, so the screen doesn't flicker back.
      if (queryClient.isMutating({ mutationKey: homeSettingsKey }) === 1) {
        void queryClient.invalidateQueries({ queryKey: homeSettingsKey });
      }
    },
  });
}

/** The hidden sections after showing or hiding `id`: each once, in Home's order. */
export function withSection(
  hidden: readonly HomeSectionId[],
  id: HomeSectionId,
  shown: boolean,
): HomeSectionId[] {
  return HOME_SECTION_IDS.filter((one) => (one === id ? !shown : hidden.includes(one)));
}
