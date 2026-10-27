// The events mentions emit (decision 0007, section 2.4), after the database commit.
import type { MentionStatus } from '@carehub/shared';

export type MentionCreatedEvent = {
  mentionId: string;
  workspaceId: string;
  pageId: string;
  /** The person mentioned. */
  userId: string;
  by: string;
  /** Page text: the block. A comment: the comment. */
  blockId: string | null;
  commentId: string | null;
  /** `waiting` when a notice is on its way. */
  status: MentionStatus;
};

declare module '../../core/events' {
  interface CareHubEvents {
    'mention.created': MentionCreatedEvent;
  }
}
