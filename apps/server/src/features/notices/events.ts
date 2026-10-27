// The app.events this feature emits (core/events.ts).
import type { NoticeCreatedEvent } from './types';

declare module '../../core/events' {
  interface CareHubEvents {
    /** NOTICE_CREATED_EVENT: after the commit, for every notice sent (not for duplicates). */
    'notices.notice.created': NoticeCreatedEvent;
  }
}
