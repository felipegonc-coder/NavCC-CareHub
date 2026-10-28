// Changing workspace templates (card menu: Rename, Change category, Who can use it, Delete) and
// hiding starters for everyone (spec 2 and 3.1). Pages made from a template never change.
import type { TemplateCard } from '@carehub/extras/templates/gallery';
import type { UpdateTemplateInput } from '@carehub/extras/templates/schemas';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db';
import { users } from '../auth/schema';
import { core, type TemplatesViewer } from './core';
import { tplHiddenStarters, tplTemplates } from './schema';
import { audienceSpace, forbidden, loadTemplate, notFound, UUID, workspaceCard } from './service';
import { STARTERS_BY_KEY } from './starters';

/** A workspace template this person may change (starters can't change: 403). */
async function manageable(db: Db, viewer: TemplatesViewer, id: string) {
  if (!UUID.test(id)) throw STARTERS_BY_KEY.has(id) ? forbidden() : notFound();
  if (!viewer.can('templates.manage')) throw forbidden();
  const { row } = await loadTemplate(db, viewer, id);
  if (!row) throw notFound();
  return row;
}

/** PATCH /api/templates/:id: Rename, Change category, Who can use it. */
export async function updateTemplate(
  db: Db,
  viewer: TemplatesViewer,
  id: string,
  input: UpdateTemplateInput,
): Promise<TemplateCard> {
  const row = await manageable(db, viewer, id);
  const { audience } = input;
  const spaceName = audience ? await audienceSpace(db, viewer, audience) : undefined;
  const [updated] = await db
    .update(tplTemplates)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(audience === undefined
        ? {}
        : {
            audience: audience.type,
            spaceId: audience.type === 'space' ? audience.spaceId : null,
          }),
      updatedBy: viewer.userId,
      updatedAt: new Date(),
    })
    .where(eq(tplTemplates.id, row.id))
    .returning();
  if (!updated) throw notFound();
  const [maker] = updated.createdBy
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, updated.createdBy))
    : [];
  const space =
    spaceName ??
    (updated.spaceId ? (await core().space(db, viewer.userId, updated.spaceId))?.name : undefined);
  return workspaceCard({ template: updated, byName: maker?.name ?? null }, viewer, space);
}

/** DELETE /api/templates/:id. Pages made from it stay as they are. */
export async function deleteTemplate(db: Db, viewer: TemplatesViewer, id: string): Promise<void> {
  const row = await manageable(db, viewer, id);
  await db.delete(tplTemplates).where(eq(tplTemplates.id, row.id));
}

/** PUT or DELETE /api/templates/:id/hidden: Hide for everyone (Admins only). */
export async function setStarterHidden(
  db: Db,
  viewer: TemplatesViewer,
  key: string,
  hidden: boolean,
): Promise<void> {
  if (!viewer.isAdmin) throw forbidden();
  if (!STARTERS_BY_KEY.has(key)) throw notFound();
  const { workspaceId, userId } = viewer;
  if (hidden) {
    await db
      .insert(tplHiddenStarters)
      .values({ workspaceId, starterKey: key, hiddenBy: userId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(tplHiddenStarters)
      .where(
        and(eq(tplHiddenStarters.workspaceId, workspaceId), eq(tplHiddenStarters.starterKey, key)),
      );
  }
}
