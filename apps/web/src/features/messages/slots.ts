import { MessageCircle } from 'lucide-react';
import type { FeatureSlots } from '../../slots';
import { useMessagesBadge } from './badge';

/** What Messages adds to the shell: the sidebar item with its badge, and New message in Ctrl+K. */
export const slots: FeatureSlots = {
  sidebarItems: [
    {
      id: 'messages',
      label: 'Messages',
      icon: MessageCircle,
      to: '/messages',
      order: 20,
      useBadge: useMessagesBadge,
    },
  ],
  commands: [
    {
      id: 'messages.new',
      title: 'New message',
      keywords: ['chat', 'direct message', 'group'],
      group: 'Messages',
      run: ({ navigate }) => navigate('/messages?new=1'),
    },
  ],
};
