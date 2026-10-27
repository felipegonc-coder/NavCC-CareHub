import type { ChatJson, MessageJson } from '@carehub/team-chat';

// Fictional people and chats for the Messages tests.
export const AVERY = 'u-avery';
export const SAM = 'u-sam';
export const RILEY = 'u-riley';

export const people = {
  [AVERY]: { name: 'Avery Lin' },
  [SAM]: { name: 'Sam Ortiz' },
  [RILEY]: { name: 'Riley Chen', removed: true },
};

export function message(seq: number, change: Partial<MessageJson> = {}): MessageJson {
  return {
    id: `m-${seq}`,
    chatId: 'c-1',
    seq,
    kind: 'message',
    senderId: SAM,
    clientId: null,
    text: `Message ${seq}`,
    mentions: [],
    pageIds: [],
    system: null,
    createdAt: '2026-10-27T15:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    ...change,
  };
}

export function chat(change: Partial<ChatJson> = {}): ChatJson {
  return {
    id: 'c-1',
    type: 'direct',
    name: null,
    startedBy: AVERY,
    createdAt: '2026-10-26T15:00:00.000Z',
    lastMessageAt: '2026-10-27T15:00:00.000Z',
    lastSeq: 1,
    members: [
      { userId: AVERY, joinedAt: '2026-10-26T15:00:00.000Z', canRemoveOthers: false },
      { userId: SAM, joinedAt: '2026-10-26T15:00:00.000Z', canRemoveOthers: false },
    ],
    muted: false,
    lastReadSeq: 0,
    unread: 1,
    mentions: 0,
    lastMessage: message(1),
    ...change,
  };
}
