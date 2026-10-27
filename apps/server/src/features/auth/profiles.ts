import { inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { users } from './schema';

/** What other features show of a person: their name and picture. */
export type Profile = { id: string; name: string; avatarUrl: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names and pictures by user id, for showing people; ids that aren't users are left out. */
export async function getProfiles(
  db: Db | Tx,
  userIds: Iterable<string>,
): Promise<Map<string, Profile>> {
  const ids = [...new Set(userIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}
