import { CALENDAR_CHANGED, type LayerPatch, type LayersResponse } from '@carehub/team-calendar-api';
import type { Layer } from '@carehub/team-calendar-api';
import { and, eq } from 'drizzle-orm';
import { httpError } from '../../../core/errors';
import type { Db } from '../../../db';
import { publishToUsers } from '../../live';
import { calLayers } from '../schema';
import { BUILT_INS, layerJson, patched, withDefaults } from './model';

/** Whose layers: one person in one workspace. */
export type LayerOwner = { id: string; workspaceId: string };

const ownedBy = (owner: LayerOwner) =>
  and(eq(calLayers.workspaceId, owner.workspaceId), eq(calLayers.userId, owner.id));

/** The person's layers, in their order (CA-04: their own settings only). */
export async function listLayers(db: Db, owner: LayerOwner): Promise<LayersResponse> {
  const rows = await db.select().from(calLayers).where(ownedBy(owner));
  return { layers: withDefaults(rows).map(layerJson) };
}

/** Turns a layer on or off, recolours it or moves it in the list, for this person only. */
export async function changeLayer(
  db: Db,
  owner: LayerOwner,
  layerId: string,
  patch: LayerPatch,
): Promise<{ layer: Layer }> {
  const layer = BUILT_INS.find((each) => each.id === layerId);
  if (!layer) throw httpError(404, 'not_found');
  const changes: Partial<typeof calLayers.$inferInsert> = { updatedAt: new Date() };
  if (patch.color !== undefined) changes.color = patch.color;
  if (patch.on !== undefined) changes.on = patch.on;
  if (patch.order !== undefined) changes.order = patch.order;
  const [row] = await db
    .insert(calLayers)
    .values({ ...patched(layer, patch), workspaceId: owner.workspaceId, userId: owner.id })
    .onConflictDoUpdate({
      target: [calLayers.workspaceId, calLayers.userId, calLayers.id],
      set: changes,
    })
    .returning();
  if (!row) throw new Error('The layer change returned no row.');
  publishToUsers([owner.id], { type: CALENDAR_CHANGED, data: { layerId } });
  return { layer: layerJson(row) };
}
