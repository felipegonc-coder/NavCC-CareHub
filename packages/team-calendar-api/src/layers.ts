import { z } from 'zod';
import { idSchema } from './values';

/** The layers every person has, with these fixed ids. */
export const BUILT_IN_LAYERS = {
  myEvents: 'my-events',
  meetings: 'meetings',
  learning: 'learning',
} as const;

export const layerKindSchema = z.enum([
  'my-events',
  'meetings',
  'database',
  'learning',
  'google',
  'google-bridge',
  'icloud',
  'link',
]);
export type LayerKind = z.infer<typeof layerKindSchema>;

/** A design-kit picked colour name, never a hex value. */
export const layerColorSchema = z
  .string()
  .regex(/^[a-z][a-z-]{0,39}$/, 'Pick a colour from the list.');

/** One layer in the left panel, with this person's settings. */
export const layerSchema = z.object({
  id: idSchema,
  kind: layerKindSchema,
  name: z.string(),
  color: layerColorSchema,
  on: z.boolean(),
  order: z.number().int(),
  status: z.enum(['ok', 'error']),
  /** Why the layer is failing, and the button to show. Null when it works. */
  error: z.object({ message: z.string(), action: z.enum(['retry', 'reconnect']) }).nullable(),
  /** Database layers: where the dates come from. */
  database: z
    .object({ databaseId: idSchema, propertyId: idSchema, viewId: idSchema.nullable() })
    .nullable(),
  /** Connected calendars: the connection that Retry, Reconnect and Remove act on. */
  connectionId: idSchema.nullable(),
});
export type Layer = z.infer<typeof layerSchema>;

/** `GET /api/calendar/layers` */
export const layersResponseSchema = z.object({ layers: z.array(layerSchema) });
export type LayersResponse = z.infer<typeof layersResponseSchema>;

/** `PATCH /api/calendar/layers/:layerId`: at least one of the fields. */
export const layerPatchSchema = z
  .strictObject({
    on: z.boolean().optional(),
    color: layerColorSchema.optional(),
    order: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Send at least one change.');
export type LayerPatch = z.infer<typeof layerPatchSchema>;

/** `POST /api/calendar/layers`: add a database layer (201 `{ layer }`). */
export const addDatabaseLayerSchema = z.strictObject({
  kind: z.literal('database'),
  databaseId: idSchema,
  propertyId: idSchema,
  /** Only rows in this view, using its filters. */
  viewId: idSchema.nullable().optional(),
});
export type AddDatabaseLayer = z.infer<typeof addDatabaseLayerSchema>;
