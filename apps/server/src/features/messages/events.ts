/**
 * `messages.message.created`: someone sent a message (never for system lines or notices), emitted
 * after the commit. Web push (W1-C) notifies the recipients, using getMessageForPush.
 */
export interface MessageCreatedEvent {
  workspaceId: string;
  chatId: string;
  messageId: string;
  senderId: string;
  /** The chat's current members except the sender. */
  recipientIds: string[];
}

declare module '../../core/events' {
  interface CareHubEvents {
    'messages.message.created': MessageCreatedEvent;
  }
}
