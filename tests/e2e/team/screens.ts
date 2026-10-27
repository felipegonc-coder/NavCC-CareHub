import type { Screen } from '../screens.js';

// The screens of the team lane. Names start with "team-"; see ../README.md.
export const screens: Screen[] = [
  // Messages: the chat list with 🔔 Care Hub first, beside the open chat (docs/team/testing/messages.md).
  { name: 'team-messages', path: '/messages' },
  {
    name: 'team-messages-new',
    path: '/messages',
    // New message: the people picker.
    setup: async (page) => {
      await page.getByRole('main').getByRole('button', { name: 'New message' }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
];
