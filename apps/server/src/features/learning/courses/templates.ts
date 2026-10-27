import {
  BLOCK_TEMPLATE_LIMITS,
  newId,
  type BlockTemplate,
  type CreateBlockTemplateRequest,
} from '@carehub/learning';
import { and, count, desc, eq } from 'drizzle-orm';
import type { Db, Tx } from '../db';
import { httpError } from '../errors';
import { learningBlockTemplates as templates } from './schema';
import type { Actor } from './service';

// Block templates (docs/learning/api.md): blocks saved by an author for everyone in the workspace who builds
// courses. Studio gives the blocks new ids when it adds them to a course (addBlocks).

type TemplateRow = typeof templates.$inferSelect;

const templateOf = (row: TemplateRow): BlockTemplate => ({
  id: row.id,
  name: row.name,
  blocks: row.blocks,
  createdAt: row.createdAt.toISOString(),
});

/** The workspace's block templates, newest first. */
export async function listBlockTemplates(db: Db | Tx, actor: Actor): Promise<BlockTemplate[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(eq(templates.workspaceId, actor.workspaceId))
    .orderBy(desc(templates.createdAt));
  return rows.map(templateOf);
}

export async function createBlockTemplate(
  db: Db | Tx,
  actor: Actor,
  input: CreateBlockTemplateRequest,
): Promise<BlockTemplate> {
  const [kept] = await db
    .select({ total: count() })
    .from(templates)
    .where(eq(templates.workspaceId, actor.workspaceId));
  if ((kept?.total ?? 0) >= BLOCK_TEMPLATE_LIMITS.perWorkspace) {
    throw httpError(
      400,
      `A workspace can keep ${BLOCK_TEMPLATE_LIMITS.perWorkspace} block templates. Delete one you don't use first.`,
    );
  }
  const [row] = await db
    .insert(templates)
    .values({
      workspaceId: actor.workspaceId,
      id: newId(),
      name: input.name,
      blocks: input.blocks,
      createdBy: actor.userId,
    })
    .returning();
  if (!row) throw new Error('The block template was not saved.');
  return templateOf(row);
}

export async function deleteBlockTemplate(db: Db | Tx, actor: Actor, id: string): Promise<void> {
  const deleted = await db
    .delete(templates)
    .where(and(eq(templates.workspaceId, actor.workspaceId), eq(templates.id, id)))
    .returning({ id: templates.id });
  if (deleted.length === 0) throw httpError(404);
}
