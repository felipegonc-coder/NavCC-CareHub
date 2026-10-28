import type { CalendarSettings, SettingsPatch } from '@carehub/team-calendar-api';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { calSettings } from '../schema';
import { settingsOf } from './model';

/** Whose settings: one person in one workspace. */
export type SettingsOwner = { id: string; workspaceId: string };

/** The person's Calendar settings, with the defaults for anything they never changed. */
export async function getSettings(db: Db | Tx, owner: SettingsOwner): Promise<CalendarSettings> {
  const [row] = await db
    .select({ settings: calSettings.settings })
    .from(calSettings)
    .where(and(eq(calSettings.workspaceId, owner.workspaceId), eq(calSettings.userId, owner.id)));
  return settingsOf(row?.settings);
}

/** Saves the changed settings over the saved ones, in one statement. */
export async function changeSettings(
  db: Db,
  owner: SettingsOwner,
  patch: SettingsPatch,
): Promise<CalendarSettings> {
  const [row] = await db
    .insert(calSettings)
    .values({ workspaceId: owner.workspaceId, userId: owner.id, settings: patch })
    .onConflictDoUpdate({
      target: [calSettings.workspaceId, calSettings.userId],
      set: { settings: sql`${calSettings.settings} || excluded.settings`, updatedAt: new Date() },
    })
    .returning({ settings: calSettings.settings });
  return settingsOf(row?.settings);
}
