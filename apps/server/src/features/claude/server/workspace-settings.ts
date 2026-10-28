import { and, eq, like, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { users } from '../../auth/schema';
import { claudeSettings } from '../schema';

// stand-in: getWorkspaceSetting / setWorkspaceSetting from features/workspaces (decision 0007).
// Until they exist, Claude keeps its workspace settings in claude_settings, with the same names and
// arguments. A missing row is off.

export async function getWorkspaceSetting(
  db: Db | Tx,
  workspaceId: string,
  key: string,
): Promise<unknown> {
  const [row] = await db
    .select({ value: claudeSettings.value })
    .from(claudeSettings)
    .where(and(eq(claudeSettings.workspaceId, workspaceId), eq(claudeSettings.key, key)));
  return row?.value;
}

/** Every `claude.*` setting the workspace has, by key. */
export async function getClaudeSettings(
  db: Db | Tx,
  workspaceId: string,
): Promise<Map<string, unknown>> {
  const rows = await db
    .select({ key: claudeSettings.key, value: claudeSettings.value })
    .from(claudeSettings)
    .where(and(eq(claudeSettings.workspaceId, workspaceId), like(claudeSettings.key, 'claude.%')));
  return new Map(rows.map((row) => [row.key, row.value]));
}

// stand-in: the record of changes that workspace settings will keep, once they exist.
/**
 * Who last changed each `claude.*` setting and when, by key: their name, or null once their account
 * is gone.
 */
export async function claudeSettingChanges(
  db: Db | Tx,
  workspaceId: string,
): Promise<Map<string, { by: string | null; at: Date }>> {
  const rows = await db
    .select({ key: claudeSettings.key, by: users.name, at: claudeSettings.updatedAt })
    .from(claudeSettings)
    .leftJoin(users, eq(users.id, claudeSettings.updatedBy))
    .where(and(eq(claudeSettings.workspaceId, workspaceId), like(claudeSettings.key, 'claude.%')));
  return new Map(rows.map((row) => [row.key, { by: row.by, at: row.at }]));
}

export async function setWorkspaceSetting(
  db: Db | Tx,
  workspaceId: string,
  key: string,
  value: unknown,
  userId: string,
): Promise<void> {
  // As JSON text cast to jsonb, so null is saved as JSON null (CL-D3's "kept until deleted").
  const json = sql`${JSON.stringify(value ?? null)}::jsonb`;
  await db
    .insert(claudeSettings)
    .values({ workspaceId, key, value: json, updatedBy: userId })
    .onConflictDoUpdate({
      target: [claudeSettings.workspaceId, claudeSettings.key],
      set: { value: json, updatedBy: userId, updatedAt: sql`now()` },
    });
}
