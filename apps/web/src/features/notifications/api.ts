// Settings → Notifications on /api/push (apps/server/src/features/push/routes.ts): the person's
// notification settings, pausing them, their browsers, a test notification, and whether push is
// set up.
import { z } from 'zod';
import { api } from '../../lib/api';

export const NOTIFY_ABOUT = ['all', 'mentions', 'nothing'] as const;
export type NotifyAbout = (typeof NOTIFY_ABOUT)[number];

/**
 * How a pause ends: in 1 hour, tomorrow at 8:00 AM in the person's time zone, or when turned off.
 */
export const PAUSE_ENDS = ['in_an_hour', 'tomorrow_8am', 'when_turned_on'] as const;
export type PauseEnds = (typeof PAUSE_ENDS)[number];

const preferences = z.object({
  notifyAbout: z.enum(NOTIFY_ABOUT),
  showText: z.boolean(),
  /** Null when not paused. `until` is an ISO instant, or null until turned back on. */
  pause: z.object({ until: z.iso.datetime({ offset: true }).nullable() }).nullable(),
});
export type NotificationPreferences = z.infer<typeof preferences>;
/** What PATCH /api/push/preferences changes. Pausing has its own calls. */
export type PreferenceChanges = Partial<Pick<NotificationPreferences, 'notifyAbout' | 'showText'>>;
const preferencesAnswer = z.object({ preferences });

const device = z.object({
  id: z.string(),
  device: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
});
/** One browser that gets notifications. The server never shows its address or keys. */
export type PushDevice = z.infer<typeof device>;
const devicesAnswer = z.object({ subscriptions: z.array(device) });

const testAnswer = z.object({ sent: z.number(), removed: z.number(), failed: z.number() });
export type TestResult = z.infer<typeof testAnswer>;

const keyAnswer = z.object({ publicKey: z.string().nullable() });

/** What the section needs from the server; tests pass a stand-in. */
export interface NotificationsClient {
  getPreferences(): Promise<NotificationPreferences>;
  updatePreferences(changes: PreferenceChanges): Promise<NotificationPreferences>;
  /** "Pause notifications": the server works out when the pause ends. */
  pause(ends: PauseEnds): Promise<NotificationPreferences>;
  /** "Turn back on". */
  resume(): Promise<NotificationPreferences>;
  listDevices(): Promise<PushDevice[]>;
  removeDevice(id: string): Promise<void>;
  sendTest(): Promise<TestResult>;
  /** False while the server's PUSH_VAPID_* settings are missing. */
  pushIsSetUp(): Promise<boolean>;
}

export const notificationsClient: NotificationsClient = {
  async getPreferences() {
    return (await api.get('/api/push/preferences', { schema: preferencesAnswer })).preferences;
  },
  async updatePreferences(changes) {
    const answer = await api.patch('/api/push/preferences', changes, { schema: preferencesAnswer });
    return answer.preferences;
  },
  async pause(ends) {
    return (await api.put('/api/push/pause', { ends }, { schema: preferencesAnswer })).preferences;
  },
  async resume() {
    const answer = await api.delete('/api/push/pause', undefined, { schema: preferencesAnswer });
    return answer.preferences;
  },
  async listDevices() {
    return (await api.get('/api/push/subscriptions', { schema: devicesAnswer })).subscriptions;
  },
  async removeDevice(id) {
    await api.delete(`/api/push/subscriptions/${encodeURIComponent(id)}`);
  },
  sendTest() {
    return api.post('/api/push/test', undefined, { schema: testAnswer });
  },
  async pushIsSetUp() {
    return (await api.get('/api/push/key', { schema: keyAnswer })).publicKey !== null;
  },
};

/** TanStack Query keys; all start with the feature name. */
export const notificationKeys = {
  preferences: ['notifications', 'preferences'],
  devices: ['notifications', 'devices'],
  server: ['notifications', 'server'],
  browser: ['notifications', 'browser'],
} as const;
