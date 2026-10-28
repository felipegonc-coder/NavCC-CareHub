import { House } from 'lucide-react';
import type { FeatureSlots } from '../../slots';
import { SidebarUpcoming } from './SidebarUpcoming';

/** Home's part of the shell: its top item in the sidebar, and Upcoming under the top items. */
export const slots: FeatureSlots = {
  sidebarItems: [{ id: 'home', label: 'Home', icon: House, to: '/', order: 10 }],
  sidebarSections: [{ id: 'home-upcoming', order: 10, Component: SidebarUpcoming }],
};
