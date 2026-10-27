// The events comments emit (decision 0007, section 2.4), after the database commit.

export type CommentCreatedEvent = {
  commentId: string;
  threadId: string;
  pageId: string;
  workspaceId: string;
  /** The author. */
  by: string;
  /** It started the thread; otherwise it's a reply. */
  newThread: boolean;
};

/** Its author changed the text, maybe mentioning someone new. */
export type CommentEditedEvent = Omit<CommentCreatedEvent, 'newThread'>;

declare module '../../core/events' {
  interface CareHubEvents {
    'comment.created': CommentCreatedEvent;
    'comment.edited': CommentEditedEvent;
  }
}
