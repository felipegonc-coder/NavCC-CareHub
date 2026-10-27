import { isColorName, type ColorName } from '@carehub/ui';

/** Someone else who has the page open, as the collab server describes them. */
export interface Person {
  id: string;
  /** First name, shown next to their caret. */
  name: string;
  fullName: string;
  avatarUrl: string | null;
  color: ColorName;
}

/** The collab server's presence colors, picked from the person's id the same way. */
const PRESENCE_COLORS = [
  'blue',
  'pink',
  'green',
  'orange',
  'purple',
  'red',
  'brown',
  'yellow',
] as const;

export function presenceColor(userId: string): ColorName {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length] ?? 'blue';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;

/** The people in awareness `states` other than you, once each (one may have two tabs open). */
export function peopleOnPage(
  states: ReadonlyMap<number, Record<string, unknown>>,
  selfClientId: number,
  selfUserId: string,
): Person[] {
  const people = new Map<string, Person>();
  for (const [clientId, state] of states) {
    const user = (state.user ?? {}) as Record<string, unknown>;
    const id = text(user.id);
    const fullName = text(user.fullName) ?? text(user.name);
    if (clientId === selfClientId || !id || id === selfUserId || !fullName || people.has(id)) {
      continue;
    }
    const { color, avatarUrl } = user;
    people.set(id, {
      id,
      name: text(user.name) ?? firstName(fullName),
      fullName,
      avatarUrl:
        typeof avatarUrl === 'string' && /^(\/(?!\/)|https:\/\/)/.test(avatarUrl)
          ? avatarUrl
          : null,
      color: typeof color === 'string' && isColorName(color) ? color : 'gray',
    });
  }
  return [...people.values()];
}
