import { COPY, GROUP_MAX_PEOPLE, GROUP_MIN_PEOPLE, GROUP_NAME_MAX_LENGTH } from './constants';
import { listNames, namesOf, personName } from './names';
import type { SystemEvent } from './system-lines';
import { collapseWhitespace, countCharacters, isBlankText, normalizeMessageText } from './text';
import type { ChatType, NameOf } from './types';

export interface ChatMember {
  userId: string;
  joinedAt: Date;
  /** The person who started the group, or who took over from them, can remove people. */
  canRemoveOthers: boolean;
  leftAt: Date | null;
}

export type ChatChangeError =
  | 'not-a-group'
  | 'not-in-chat'
  | 'already-in-chat'
  | 'group-too-big'
  | 'cannot-remove-people'
  | 'person-not-in-chat'
  | 'remove-yourself'
  | 'cannot-leave'
  | 'name-too-long'
  | 'unchanged';

type Plan<T> = ({ ok: true } & T) | { ok: false; error: ChatChangeError };

/** The chat, its members (current and past) and the person asking. */
export interface GroupContext {
  chatType: ChatType;
  members: readonly ChatMember[];
  actorId: string;
}

const isCurrent = (member: ChatMember) => member.leftAt === null;
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byJoined = (a: ChatMember, b: ChatMember) =>
  a.joinedAt.getTime() - b.joinedAt.getTime() || compareIds(a.userId, b.userId);

function currentMember(members: readonly ChatMember[], userId: string) {
  return members.find((member) => member.userId === userId && isCurrent(member));
}

/** The key of the one direct chat for a pair, whatever order the two come in. */
export function directChatKey(userA: string, userB: string): string {
  if (userA === userB) throw new Error('A direct chat needs two different people');
  return userA < userB ? `${userA}:${userB}` : `${userB}:${userA}`;
}

/** The same key for the same people, to offer "Open existing chat" for a group. */
export function membersKey(userIds: Iterable<string>): string {
  return [...new Set(userIds)].sort().join(':');
}

/** One line, trimmed; blank means no name, and the members' names show instead. */
export function normalizeGroupName(
  raw: string | null | undefined,
): { ok: true; name: string | null } | { ok: false; error: 'name-too-long' } {
  const name = collapseWhitespace(normalizeMessageText(raw ?? ''));
  if (isBlankText(name)) return { ok: true, name: null };
  if (countCharacters(name) > GROUP_NAME_MAX_LENGTH) return { ok: false, error: 'name-too-long' };
  return { ok: true, name };
}

export type NewChatPlan =
  | { ok: true; type: 'direct'; otherUserId: string; directKey: string }
  | {
      ok: true;
      type: 'group';
      memberIds: string[];
      name: string | null;
      membersKey: string;
      event: SystemEvent;
    }
  | { ok: false; error: 'no-people' | 'group-too-big' | 'name-too-long' };

/** New message: one person opens your direct chat with them; more start a group of 3 to 50. */
export function planNewChat(input: {
  starterId: string;
  pickedIds: readonly string[];
  name?: string | null;
}): NewChatPlan {
  const { starterId } = input;
  const others = [...new Set(input.pickedIds)].filter((id) => id !== starterId);
  const [first] = others;
  if (first === undefined) return { ok: false, error: 'no-people' };
  if (others.length + 1 < GROUP_MIN_PEOPLE) {
    return {
      ok: true,
      type: 'direct',
      otherUserId: first,
      directKey: directChatKey(starterId, first),
    };
  }
  const memberIds = [starterId, ...others];
  if (memberIds.length > GROUP_MAX_PEOPLE) return { ok: false, error: 'group-too-big' };
  const named = normalizeGroupName(input.name);
  if (!named.ok) return named;
  const event: SystemEvent = { kind: 'started', actorId: starterId, name: named.name };
  return {
    ok: true,
    type: 'group',
    memberIds,
    name: named.name,
    membersKey: membersKey(memberIds),
    event,
  };
}

function checkGroupActor(context: GroupContext): ChatChangeError | null {
  if (context.chatType !== 'group') return 'not-a-group';
  if (!currentMember(context.members, context.actorId)) return 'not-in-chat';
  return null;
}

/** Anyone in a group can add people, up to 50 (the web first warns "They'll see earlier messages."). */
export function planAddPeople(
  context: GroupContext,
  userIds: readonly string[],
): Plan<{ addIds: string[]; event: SystemEvent }> {
  const error = checkGroupActor(context);
  if (error) return { ok: false, error };
  const current = new Set(context.members.filter(isCurrent).map((member) => member.userId));
  const addIds = [...new Set(userIds)].filter((id) => !current.has(id));
  if (addIds.length === 0) return { ok: false, error: 'already-in-chat' };
  if (current.size + addIds.length > GROUP_MAX_PEOPLE) return { ok: false, error: 'group-too-big' };
  return { ok: true, addIds, event: { kind: 'added', actorId: context.actorId, userIds: addIds } };
}

/** The person who started the group (or took over) can remove others; to go yourself, leave. */
export function planRemovePerson(
  context: GroupContext,
  userId: string,
): Plan<{ event: SystemEvent }> {
  const error = checkGroupActor(context);
  if (error) return { ok: false, error };
  if (userId === context.actorId) return { ok: false, error: 'remove-yourself' };
  if (!currentMember(context.members, context.actorId)?.canRemoveOthers) {
    return { ok: false, error: 'cannot-remove-people' };
  }
  if (!currentMember(context.members, userId)) return { ok: false, error: 'person-not-in-chat' };
  return { ok: true, event: { kind: 'removed', actorId: context.actorId, userId } };
}

/** The current member who joined first; ties go to the smaller user ID so every server agrees. */
export function longestStanding(members: readonly ChatMember[]): ChatMember | undefined {
  return members.filter(isCurrent).sort(byJoined)[0];
}

/**
 * Anyone can leave a group. If they could remove people and nobody else can, the longest-standing
 * member takes over. Direct chats and the 🔔 Care Hub chat can't be left.
 */
export function planLeave(
  context: GroupContext,
): Plan<{ events: SystemEvent[]; newRemoverId: string | null }> {
  const error = checkGroupActor(context);
  if (error) return { ok: false, error: error === 'not-a-group' ? 'cannot-leave' : error };
  const { actorId, members } = context;
  const rest = members.filter((member) => member.userId !== actorId);
  const events: SystemEvent[] = [{ kind: 'left', userId: actorId }];
  let newRemoverId: string | null = null;
  const handsOver = currentMember(members, actorId)?.canRemoveOthers;
  if (handsOver && !rest.some((member) => isCurrent(member) && member.canRemoveOthers)) {
    newRemoverId = longestStanding(rest)?.userId ?? null;
    if (newRemoverId) events.push({ kind: 'tookOver', userId: newRemoverId });
  }
  return { ok: true, events, newRemoverId };
}

/** Anyone in a group can rename it; a blank name removes the name. */
export function planRename(
  context: GroupContext & { currentName: string | null },
  rawName: string | null,
): Plan<{ name: string | null; event: SystemEvent }> {
  const error = checkGroupActor(context);
  if (error) return { ok: false, error };
  const named = normalizeGroupName(rawName);
  if (!named.ok) return named;
  if (named.name === context.currentName) return { ok: false, error: 'unchanged' };
  return {
    ok: true,
    name: named.name,
    event: { kind: 'renamed', actorId: context.actorId, name: named.name },
  };
}

export interface ChatPermissions {
  /** Read messages, download files, search. */
  read: boolean;
  send: boolean;
  react: boolean;
  rename: boolean;
  addPeople: boolean;
  removePeople: boolean;
  leave: boolean;
  /** Mute and Mark as unread. */
  mute: boolean;
}

const NOTHING: ChatPermissions = {
  read: false,
  send: false,
  react: false,
  rename: false,
  addPeople: false,
  removePeople: false,
  leave: false,
  mute: false,
};

/**
 * What a person may do in a chat. Only current members get anything, whatever their role, so an
 * Admin outside a chat gets nothing (RP-D1, MS-10). Guests have only their 🔔 chat (RP-D2).
 */
export function chatPermissions(input: {
  chatType: ChatType;
  /** The person's membership, or null if they were never in the chat. */
  member: Pick<ChatMember, 'canRemoveOthers' | 'leftAt'> | null;
  isGuest: boolean;
  /** Direct chats: the other person was removed from the workspace and can't be messaged. */
  otherPersonRemoved?: boolean;
}): ChatPermissions {
  const { chatType, member } = input;
  if (!member || member.leftAt !== null) return { ...NOTHING };
  if (input.isGuest && chatType !== 'careHub') return { ...NOTHING };
  switch (chatType) {
    case 'careHub':
      return { ...NOTHING, read: true, mute: true };
    case 'direct':
      return { ...NOTHING, read: true, send: !input.otherPersonRemoved, react: true, mute: true };
    case 'group':
      return {
        read: true,
        send: true,
        react: true,
        rename: true,
        addPeople: true,
        removePeople: member.canRemoveOthers,
        leave: true,
        mute: true,
      };
  }
}

/** "Care Hub", the other person, the group's name, or the group's other members. */
export function chatTitle(
  chat: { type: ChatType; name: string | null; members: readonly ChatMember[] },
  viewerId: string,
  nameOf: NameOf,
): string {
  if (chat.type === 'careHub') return COPY.careHubChatName;
  if (chat.type === 'group' && chat.name) return chat.name;
  const others = chat.members.filter((member) => member.userId !== viewerId);
  if (chat.type === 'direct') {
    const other = others[0];
    return personName(other ? nameOf(other.userId) : undefined);
  }
  const current = others.filter(isCurrent).sort(byJoined);
  if (current.length === 0) return COPY.unnamedEmptyGroup;
  return listNames(
    namesOf(
      current.map((member) => member.userId),
      nameOf,
    ),
    3,
  );
}

export interface ChatListItem {
  id: string;
  type: ChatType;
  /** The latest message's time (or when the chat was started). */
  lastActivityAt: Date;
}

/** 🔔 Care Hub always first, then chats by latest message. */
export function sortChatList<T extends ChatListItem>(chats: readonly T[]): T[] {
  return [...chats].sort(
    (a, b) =>
      Number(b.type === 'careHub') - Number(a.type === 'careHub') ||
      b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
      compareIds(a.id, b.id),
  );
}
