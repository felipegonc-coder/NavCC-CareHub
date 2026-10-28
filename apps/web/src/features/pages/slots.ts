import { lazy } from 'react';
import type { Slots } from '../../slots';

/** The page tree under the top links, then Trash (decision 0007, section 5.3). */
export const slots: Partial<Slots> = {
  sidebarSections: [
    { id: 'pages', order: 50, Component: lazy(() => import('./PagesSidebar')) },
    // Until the shell's bottom links (Templates, Import, Trash, Settings, Help) take it.
    { id: 'trash', order: 90, Component: lazy(() => import('./TrashLink')) },
  ],
};
