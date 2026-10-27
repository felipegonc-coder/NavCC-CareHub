// Settings → Notifications, at /settings/notifications. The screen loads only when it opens.
import { lazy, Suspense } from 'react';
import type { FeatureSlots } from '../../slots';
import { TEXT } from './text';

const NotificationSettings = lazy(async () => ({
  default: (await import('./NotificationSettings')).NotificationSettings,
}));

export const slots: FeatureSlots = {
  settingsSections: [
    {
      id: 'notifications',
      label: TEXT.label,
      path: 'notifications',
      // Account: My account, Preferences, Notifications, Connections.
      order: 30,
      element: (
        <Suspense fallback={null}>
          <NotificationSettings />
        </Suspense>
      ),
    },
  ],
};
