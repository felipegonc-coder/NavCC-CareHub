import { CalendarDays } from 'lucide-react';
import type { FeatureSlots } from '../../slots';

/** What Calendar adds to the shell (decision 0007, section 5.3): its sidebar item. */
export const slots: FeatureSlots = {
  sidebarItems: [
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, to: '/calendar', order: 30 },
  ],
};
