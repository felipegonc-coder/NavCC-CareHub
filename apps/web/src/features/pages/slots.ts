import { lazy } from 'react';
import type { Slots } from '../../slots';

/** The page tree under the top links (decision 0007, section 5.3). */
export const slots: Partial<Slots> = {
  sidebarSections: [{ id: 'pages', order: 50, Component: lazy(() => import('./PagesSidebar')) }],
};
