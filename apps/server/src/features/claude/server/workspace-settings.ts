import { and, eq, like, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { claudeSettings } from '../schema';

// stand-in: getWorkspaceSetting / setWorkspaceSetting from features/workspaces (decision 0007,
// accounts 1c). Until they land, Claude keeps its workspace settings in claude_settings, with the
// same names and arguments. A missing row is off.

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
