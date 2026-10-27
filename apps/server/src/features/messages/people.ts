import type { PeopleJson } from '@carehub/team-chat';
import { inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { users } from '../auth/schema';
import { getMembership } from '../workspaces';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Users, chats and messages have UUIDs; anything else can't be one of them. */
export const isUuid = (value: string): boolean => UUID.test(value);

/**
 * Names for the people in an answer. People no longer in the workspace get `removed` ("Sam Ortiz
 * (removed)"); unknown IDs are left out ("Unknown person").
 */
export async function lookUpPeople(
  db: Db | Tx,
  workspaceId: string,
  userIds: Iterable<string>,
): Promise<PeopleJson> {
  const ids = [...new Set(userIds)].filter(isUuid);
  if (ids.length === 0) return {};
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));
  const people: PeopleJson = {};
  await Promise.all(
    rows.map(async ({ id, name }) => {
      const inWorkspace = (await getMembership(db, workspaceId, id)) !== null;
      people[id] = inWorkspace ? { name } : { name, removed: true };
    }),
  );
  return people;
}

/**
 * Whether these people can be messaged: members of the workspace. Guests have only their 🔔 chat
 * (RP-D2), and people removed from the workspace can't be messaged.
 */
export async function canBeMessaged(
  db: Db | Tx,
  workspaceId: string,
  userIds: readonly string[],
): Promise<boolean> {
  for (const id of userIds) {
    if (!isUuid(id) || (await getMembership(db, workspaceId, id))?.kind !== 'member') return false;
  }
  return true;
}
