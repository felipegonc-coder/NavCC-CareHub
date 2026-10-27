import type { FeatureSlots } from '../../slots';
import { SidebarUpcoming } from './SidebarUpcoming';

/** Home's part of the shell: Upcoming in the sidebar, first under the top items. */
export const slots: FeatureSlots = {
  sidebarSections: [{ id: 'home-upcoming', order: 10, Component: SidebarUpcoming }],
};
