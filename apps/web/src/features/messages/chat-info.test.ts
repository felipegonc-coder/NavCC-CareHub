import { describe, expect, it } from 'vitest';
import { firstName, otherPersonId, previewOf, titleOf, toUnreadChats } from './chat-info';
import { AVERY, chat, message, people, RILEY, SAM } from './test-data';

describe('chat names and previews', () => {
  it('names a direct chat after the other person, and a group after its name or members', () => {
    expect(titleOf(chat(), AVERY, people)).toBe('Sam Ortiz');
    expect(titleOf(chat(), SAM, people)).toBe('Avery Lin');
    const members = [
      ...chat().members,
      { userId: RILEY, joinedAt: '2026-10-26T16:00:00.000Z', canRemoveOthers: false },
    ];
    expect(titleOf(chat({ type: 'group', members }), AVERY, people)).toBe(
      'Sam Ortiz and Riley Chen (removed)',
    );
    expect(titleOf(chat({ type: 'group', members, name: 'Rota' }), AVERY, people)).toBe('Rota');
    expect(otherPersonId(chat(), AVERY)).toBe(SAM);
    expect(otherPersonId(chat({ type: 'group', members }), AVERY)).toBeNull();
    expect(firstName('Avery Lin')).toBe('Avery');
  });

  it('previews the latest message: yours with "You:", mentions by name, deleted ones', () => {
    const mention = message(2, { text: `<@${AVERY}> can you check Tuesday?`, mentions: [AVERY] });
    expect(previewOf(mention, AVERY, people)).toBe('@Avery Lin can you check Tuesday?');
    expect(previewOf(message(3, { senderId: AVERY, text: 'On it' }), AVERY, people)).toBe(
      'You: On it',
    );
    const deleted = message(4, { senderId: AVERY, text: '', deletedAt: '2026-10-27T15:01:00Z' });
    expect(previewOf(deleted, AVERY, people)).toBe('This message was deleted');
    const line = message(5, {
      kind: 'system',
      senderId: null,
      text: '',
      system: { kind: 'started', actorId: SAM, name: null },
    });
    expect(previewOf(line, AVERY, people)).toBe('Sam Ortiz started the group');
  });
});

describe("Home's unread chats", () => {
  it('counts like the badge: unread messages, or only @mentions when muted', () => {
    const answer = {
      viewerId: AVERY,
      people,
      chats: [
        chat({ id: 'c-1', unread: 2 }),
        chat({ id: 'c-2', muted: true, unread: 5, mentions: 1 }),
        chat({ id: 'c-3', muted: true, unread: 4, mentions: 0 }),
        chat({ id: 'c-4', unread: 0, lastMessage: null }),
      ],
    };
    expect(toUnreadChats(answer)).toEqual([
      {
        chatId: 'c-1',
        name: 'Sam Ortiz',
        preview: 'Message 1',
        unreadCount: 2,
        lastMessageAt: '2026-10-27T15:00:00.000Z',
        href: '/messages/c-1',
      },
      {
        chatId: 'c-2',
        name: 'Sam Ortiz',
        preview: 'Message 1',
        unreadCount: 1,
        lastMessageAt: '2026-10-27T15:00:00.000Z',
        href: '/messages/c-2',
      },
    ]);
  });
});
