// Reading and changing a person's Home settings in Postgres. A person without a row has the
// defaults; their first change adds the row.
import { eq } from 'drizzle-orm';
import type { Db } from '../../db';
import { homeSettings } from './schema';
import {
  DEFAULT_HOME_SETTINGS,
  inHomeOrder,
  type HomeSettings,
  type HomeSettingsChange,
} from './types';

const columns = {
  hiddenSections: homeSettings.hiddenSections,
  upcomingFolded: homeSettings.upcomingFolded,
};

const toSettings = (row: { hiddenSections: string[]; upcomingFolded: boolean }): HomeSettings => ({
  hiddenSections: inHomeOrder(row.hiddenSections),
  upcomingFolded: row.upcomingFolded,
});

export async function readHomeSettings(db: Db, userId: string): Promise<HomeSettings> {
  const [row] = await db
    .select(columns)
    .from(homeSettings)
    .where(eq(homeSettings.userId, userId))
    .limit(1);
  return toSettings(row ?? DEFAULT_HOME_SETTINGS);
}

/** Changes only the settings in `change`, in one statement, and returns them all. */
export async function changeHomeSettings(
  db: Db,
  userId: string,
  change: HomeSettingsChange,
  now: Date = new Date(),
): Promise<HomeSettings> {
  const set: Partial<typeof homeSettings.$inferInsert> = { updatedAt: now };
  if (change.hiddenSections) set.hiddenSections = inHomeOrder(change.hiddenSections);
  if (change.upcomingFolded !== undefined) set.upcomingFolded = change.upcomingFolded;
  const [row] = await db
    .insert(homeSettings)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: homeSettings.userId, set })
    .returning(columns);
  if (!row) throw new Error('Saving Home settings returned no row.');
  return toSettings(row);
}
