import type { FeatureSlots } from '../../slots';
import { SearchOverlay } from './SearchOverlay';
import { SidebarSearch } from './SidebarSearch';

/** What search adds to the shell, page view and editor (decision 0007, section 5.3). */
export const slots: FeatureSlots = {
  overlays: [{ id: 'search', Component: SearchOverlay }],
  sidebarSections: [{ id: 'search', order: 0, Component: SidebarSearch }],
};
