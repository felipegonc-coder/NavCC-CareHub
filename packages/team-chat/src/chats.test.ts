import { describe, expect, it } from 'vitest';
import {
  chatPermissions,
  chatTitle,
  directChatKey,
  longestStanding,
  membersKey,
  normalizeGroupName,
  planAddPeople,
  planLeave,
  planNewChat,
  planRemovePerson,
  planRename,
  sortChatList,
} from './chats';
import type { ChatMember } from './chats';
import { systemLineText } from './system-lines';
import type { SystemEvent } from './system-lines';
import type { PersonLabel } from './types';

const people: Record<string, PersonLabel> = {
  avery: { name: 'Avery Lin' },
  sam: { name: 'Sam Ortiz' },
  riley: { name: 'Riley Chen' },
  jordan: { name: 'Jordan Patel' },
  morgan: { name: 'Morgan Lee', removed: true },
  casey: { name: 'Casey Nguyen' },
};
const nameOf = (id: string) => people[id];
const line = (event: SystemEvent) => systemLineText(event, nameOf);

const day = (n: number) => new Date(Date.UTC(2026, 9, n));
const member = (userId: string, joined: number, extra: Partial<ChatMember> = {}): ChatMember => ({
  userId,
  joinedAt: day(joined),
  canRemoveOthers: false,
  leftAt: null,
  ...extra,
});
/** Avery started the group with Sam and Riley; Jordan joined later. */
const standUp = () => [
  member('avery', 1, { canRemoveOthers: true }),
  member('sam', 1),
  member('riley', 1),
  member('jordan', 3),
];

describe('starting chats', () => {
  it('opens the one direct chat for a pair, whatever order they come in', () => {
    const plan = planNewChat({ starterId: 'avery', pickedIds: ['sam', 'avery'] });
    expect(plan).toEqual({
      ok: true,
      type: 'direct',
      otherUserId: 'sam',
      directKey: directChatKey('sam', 'avery'),
    });
    expect(directChatKey('avery', 'sam')).toBe(directChatKey('sam', 'avery'));
    expect(() => directChatKey('sam', 'sam')).toThrow();
    expect(planNewChat({ starterId: 'avery', pickedIds: ['avery'] })).toEqual({
      ok: false,
      error: 'no-people',
    });
  });

  it('MS-02 starts a group of 3 with an optional name and a line', () => {
    const plan = planNewChat({
      starterId: 'avery',
      pickedIds: ['sam', 'riley', 'sam'],
      name: '  Weekly   stand-up ',
    });
    if (!plan.ok || plan.type !== 'group') throw new Error('expected a group');
    expect(plan.memberIds).toEqual(['avery', 'sam', 'riley']);
    expect(plan.name).toBe('Weekly stand-up');
    expect(line(plan.event)).toBe("Avery Lin started the group 'Weekly stand-up'");
    const unnamed = planNewChat({ starterId: 'avery', pickedIds: ['sam', 'riley'], name: '   ' });
    expect(unnamed).toMatchObject({ ok: true, type: 'group', name: null });
  });

  it('offers the existing group with exactly the same people', () => {
    expect(membersKey(['sam', 'avery', 'riley'])).toBe(
      membersKey(['riley', 'sam', 'avery', 'sam']),
    );
    expect(membersKey(['sam', 'avery'])).not.toBe(membersKey(['sam', 'avery', 'riley']));
  });

  it('keeps groups to 50 people and names to 100 characters', () => {
    const picked = (n: number) => Array.from({ length: n }, (_, i) => `person-${i}`);
    expect(planNewChat({ starterId: 'avery', pickedIds: picked(49) })).toMatchObject({ ok: true });
    expect(planNewChat({ starterId: 'avery', pickedIds: picked(50) })).toEqual({
      ok: false,
      error: 'group-too-big',
    });
    expect(normalizeGroupName('a'.repeat(100))).toEqual({ ok: true, name: 'a'.repeat(100) });
    expect(normalizeGroupName('a'.repeat(101))).toEqual({ ok: false, error: 'name-too-long' });
    expect(normalizeGroupName('Care\nTeam   Demo')).toEqual({ ok: true, name: 'Care Team Demo' });
    expect(normalizeGroupName(null)).toEqual({ ok: true, name: null });
  });
});

describe('MS-02 changing a group', () => {
  it('lets anyone rename it, and a blank name removes the name', () => {
    const context = { chatType: 'group' as const, members: standUp(), actorId: 'sam' };
    const renamed = planRename({ ...context, currentName: null }, 'Stand-up');
    if (!renamed.ok) throw new Error(renamed.error);
    expect(line(renamed.event)).toBe("Sam Ortiz renamed the group to 'Stand-up'");
    const cleared = planRename({ ...context, currentName: 'Stand-up' }, ' ');
    if (!cleared.ok) throw new Error(cleared.error);
    expect(cleared.name).toBeNull();
    expect(line(cleared.event)).toBe('Sam Ortiz removed the group name');
    expect(planRename({ ...context, currentName: 'Stand-up' }, 'Stand-up ')).toEqual({
      ok: false,
      error: 'unchanged',
    });
  });

  it('lets anyone add people, up to 50', () => {
    const members = standUp().slice(0, 3);
    const added = planAddPeople({ chatType: 'group', members, actorId: 'riley' }, [
      'jordan',
      'sam',
    ]);
    if (!added.ok) throw new Error(added.error);
    expect(added.addIds).toEqual(['jordan']);
    expect(line(added.event)).toBe('Riley Chen added Jordan Patel');
    expect(planAddPeople({ chatType: 'group', members, actorId: 'riley' }, ['sam'])).toEqual({
      ok: false,
      error: 'already-in-chat',
    });
    const full = Array.from({ length: 50 }, (_, i) => member(`person-${i}`, 1));
    expect(
      planAddPeople({ chatType: 'group', members: full, actorId: 'person-0' }, ['casey']),
    ).toEqual({ ok: false, error: 'group-too-big' });
  });

  it('lets people who left be added again', () => {
    const members = [...standUp(), member('casey', 2, { leftAt: day(4) })];
    expect(planAddPeople({ chatType: 'group', members, actorId: 'sam' }, ['casey'])).toMatchObject({
      ok: true,
      addIds: ['casey'],
    });
  });

  it('lets only the person who started it remove people', () => {
    const members = standUp();
    const removed = planRemovePerson({ chatType: 'group', members, actorId: 'avery' }, 'sam');
    if (!removed.ok) throw new Error(removed.error);
    expect(line(removed.event)).toBe('Avery Lin removed Sam Ortiz');
    const tries: [string, string, string][] = [
      ['sam', 'riley', 'cannot-remove-people'],
      ['avery', 'avery', 'remove-yourself'],
      ['avery', 'casey', 'person-not-in-chat'],
      ['casey', 'sam', 'not-in-chat'],
    ];
    for (const [actorId, userId, error] of tries) {
      expect(planRemovePerson({ chatType: 'group', members, actorId }, userId)).toEqual({
        ok: false,
        error,
      });
    }
  });

  it('hands removing over to the longest-standing member when the starter leaves', () => {
    const left = planLeave({ chatType: 'group', members: standUp(), actorId: 'avery' });
    if (!left.ok) throw new Error(left.error);
    // Sam and Riley joined together; the smaller ID wins so every server agrees.
    expect(left.newRemoverId).toBe('riley');
    expect(left.events.map(line)).toEqual(['Avery Lin left', 'Riley Chen can now remove people']);
  });

  it('skips people who already left when handing over', () => {
    const members = standUp().map((m) =>
      m.userId === 'riley' || m.userId === 'sam' ? { ...m, leftAt: day(2) } : m,
    );
    expect(longestStanding(members)?.userId).toBe('avery');
    const left = planLeave({ chatType: 'group', members, actorId: 'avery' });
    expect(left).toMatchObject({ ok: true, newRemoverId: 'jordan' });
  });

  it('lets anyone else leave without a handover', () => {
    const left = planLeave({ chatType: 'group', members: standUp(), actorId: 'sam' });
    expect(left).toEqual({
      ok: true,
      events: [{ kind: 'left', userId: 'sam' }],
      newRemoverId: null,
    });
    const last = planLeave({
      chatType: 'group',
      members: [member('avery', 1, { canRemoveOthers: true })],
      actorId: 'avery',
    });
    expect(last).toEqual({
      ok: true,
      events: [{ kind: 'left', userId: 'avery' }],
      newRemoverId: null,
    });
  });

  it('MS-09 keeps direct chats and the 🔔 chat as they are', () => {
    const pair = [member('avery', 1), member('sam', 1)];
    for (const chatType of ['direct', 'careHub'] as const) {
      const context = { chatType, members: pair, actorId: 'avery' };
      expect(planLeave(context)).toEqual({ ok: false, error: 'cannot-leave' });
      expect(planRename({ ...context, currentName: null }, 'Chat')).toEqual({
        ok: false,
        error: 'not-a-group',
      });
      expect(planAddPeople(context, ['riley'])).toEqual({ ok: false, error: 'not-a-group' });
    }
  });
});

describe('chatPermissions', () => {
  const inChat = { canRemoveOthers: false, leftAt: null };

  it('MS-10 gives nothing to anyone outside the chat, Admins included', () => {
    const outside = chatPermissions({ chatType: 'group', member: null, isGuest: false });
    expect(Object.values(outside).some(Boolean)).toBe(false);
  });

  it('MS-16 gives nothing to people who left or were removed, so their file links stop working', () => {
    const left = chatPermissions({
      chatType: 'group',
      member: { canRemoveOthers: false, leftAt: day(2) },
      isGuest: false,
    });
    expect(left.read).toBe(false);
    expect(Object.values(left).some(Boolean)).toBe(false);
  });

  it('MS-09 lets people read and mute the 🔔 chat, nothing more', () => {
    expect(chatPermissions({ chatType: 'careHub', member: inChat, isGuest: false })).toEqual({
      read: true,
      send: false,
      react: false,
      rename: false,
      addPeople: false,
      removePeople: false,
      leave: false,
      mute: true,
    });
  });

  it('gives guests only their 🔔 chat (RP-D2)', () => {
    expect(chatPermissions({ chatType: 'careHub', member: inChat, isGuest: true }).read).toBe(true);
    expect(chatPermissions({ chatType: 'group', member: inChat, isGuest: true }).read).toBe(false);
    expect(chatPermissions({ chatType: 'direct', member: inChat, isGuest: true }).read).toBe(false);
  });

  it("doesn't let anyone message a person removed from the workspace", () => {
    const direct = chatPermissions({ chatType: 'direct', member: inChat, isGuest: false });
    expect(direct).toMatchObject({ read: true, send: true, react: true, leave: false });
    expect(
      chatPermissions({
        chatType: 'direct',
        member: inChat,
        isGuest: false,
        otherPersonRemoved: true,
      }),
    ).toMatchObject({ read: true, send: false });
  });

  it('lets the person who can remove others remove people in a group', () => {
    const group = chatPermissions({ chatType: 'group', member: inChat, isGuest: false });
    expect(group).toMatchObject({ send: true, rename: true, addPeople: true, leave: true });
    expect(group.removePeople).toBe(false);
    expect(
      chatPermissions({
        chatType: 'group',
        member: { canRemoveOthers: true, leftAt: null },
        isGuest: false,
      }).removePeople,
    ).toBe(true);
  });
});

describe('chat list', () => {
  it('names chats', () => {
    const pair = [member('avery', 1), member('morgan', 1)];
    expect(chatTitle({ type: 'careHub', name: null, members: [] }, 'avery', nameOf)).toBe(
      'Care Hub',
    );
    expect(chatTitle({ type: 'direct', name: null, members: pair }, 'avery', nameOf)).toBe(
      'Morgan Lee (removed)',
    );
    const members = [...standUp(), member('casey', 4)];
    expect(chatTitle({ type: 'group', name: 'Stand-up', members }, 'avery', nameOf)).toBe(
      'Stand-up',
    );
    expect(chatTitle({ type: 'group', name: null, members }, 'avery', nameOf)).toBe(
      'Riley Chen, Sam Ortiz, Jordan Patel and Casey Nguyen',
    );
    const bigger = [...members, member('morgan', 5)];
    expect(chatTitle({ type: 'group', name: null, members: bigger }, 'avery', nameOf)).toBe(
      'Riley Chen, Sam Ortiz, Jordan Patel and 2 others',
    );
    const alone = [member('avery', 1), member('sam', 1, { leftAt: day(2) })];
    expect(chatTitle({ type: 'group', name: null, members: alone }, 'avery', nameOf)).toBe(
      'Group chat',
    );
  });

  it('puts 🔔 Care Hub first, then chats by latest message', () => {
    const chats = [
      { id: 'b', type: 'group' as const, lastActivityAt: day(5) },
      { id: 'bell', type: 'careHub' as const, lastActivityAt: day(1) },
      { id: 'c', type: 'direct' as const, lastActivityAt: day(7) },
      { id: 'a', type: 'direct' as const, lastActivityAt: day(5) },
    ];
    expect(sortChatList(chats).map((chat) => chat.id)).toEqual(['bell', 'c', 'a', 'b']);
  });
});
