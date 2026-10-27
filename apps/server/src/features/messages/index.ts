// What other features may use from Messages (decision 0007, section 2.2). Web push listens for
// `messages.message.created` and looks each message up with getMessageForPush.
export type { MessageCreatedEvent } from './events';
export { getMessageForPush, type MessageForPush } from './push';
