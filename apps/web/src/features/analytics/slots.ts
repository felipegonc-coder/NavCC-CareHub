import type { FeatureSlots } from '../../slots';

// The sidebar item waits for SidebarItem to take a permission, so that only Admins see it (AN-06).
export const slots: FeatureSlots = {
  commands: [
    {
      id: 'analytics.open',
      title: 'Open Analytics',
      keywords: ['page views', 'edits', 'active people', 'usage'],
      group: 'Go to',
      permission: 'workspace.admin',
      run: ({ navigate }) => navigate('/analytics'),
    },
  ],
};
