import { AlarmClock } from 'lucide-react';
import type { FeatureSlots } from '../../slots';
import { openRemindMe, pageIdIn } from './remindMe';
import { RemindMeOverlay } from './RemindMeOverlay';

/** Remind me in the page "…" menu and in Ctrl+K, and its dialog (decision 0007, section 5.3). */
export const slots: FeatureSlots = {
  pageMenuItems: [
    {
      id: 'reminders.remind-me',
      label: 'Remind me',
      icon: AlarmClock,
      order: 50,
      onSelect: (page) => openRemindMe({ type: 'page', pageId: page.id, title: page.title }),
    },
  ],
  commands: [
    {
      id: 'reminders.remind-me',
      title: 'Remind me',
      keywords: ['remind', 'reminder'],
      // About the page that's open; elsewhere the dialog says where Remind me is.
      run: () => {
        const pageId = pageIdIn(window.location.pathname);
        openRemindMe(pageId ? { type: 'page', pageId } : null);
      },
    },
  ],
  overlays: [{ id: 'reminders.remind-me', Component: RemindMeOverlay }],
};
