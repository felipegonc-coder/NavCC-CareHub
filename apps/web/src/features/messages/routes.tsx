import type { RouteObject } from 'react-router';

/** /messages, /messages/<chatId>, and /messages/care-hub for the 🔔 chat. */
export const routes: RouteObject[] = [
  {
    path: 'messages/*',
    lazy: async () => ({ Component: (await import('./MessagesScreen')).MessagesScreen }),
  },
];
