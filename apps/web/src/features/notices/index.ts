// What other features may use from notices on the web (decision 0007, section 4.4).
import { lazy } from 'react';

/** The 🔔 Care Hub chat for `/messages/care-hub`. Render it inside Suspense. */
export const NoticesChat = lazy(() => import('./NoticesChatView'));
export type { NoticesChatProps } from './NoticesChatView';
export { useNoticesPreview, useNoticesUnread } from './hooks';
export type { NoticesPreview } from './api';
