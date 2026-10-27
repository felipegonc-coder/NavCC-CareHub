import { lazy } from 'react';
import type { Slots } from '../../slots';

/**
 * The page tree under the top links, then Trash; "New page" and "Browse spaces" (decision 0007,
 * section 5.3).
 */
export const slots: Partial<Slots> = {
  sidebarSections: [
    { id: 'pages', order: 50, Component: lazy(() => import('./PagesSidebar')) },
    // Until the shell's bottom links (Templates, Import, Trash, Settings, Help) take it.
    { id: 'trash', order: 90, Component: lazy(() => import('./TrashLink')) },
  ],
  commands: [
    {
      id: 'new-page',
      title: 'New page',
      keywords: ['add', 'create', 'page'],
      group: 'Pages',
      permission: 'pages.create',
      run: ({ navigate }) => navigate('/new'),
    },
    {
      id: 'browse-spaces',
      title: 'Browse spaces',
      keywords: ['join', 'space', 'team'],
      group: 'Pages',
      run: ({ navigate }) => navigate('/spaces'),
    },
  ],
};
