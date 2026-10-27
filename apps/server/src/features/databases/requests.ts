// Request bodies for the database routes that the package's schemas don't cover (decision 0200).
// Parse them with parseRequest from '@carehub/databases/schemas', like every other body.
import { LIMITS } from '@carehub/databases';
import {
  idSchema,
  lineSchema,
  propertyAccessSchema,
  propertySchema,
  richTextSchema,
  rowPageLayoutSchema,
} from '@carehub/databases/schemas';
import { z } from 'zod';

/** A page id. */
export const pageIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** The version a settings write was made from (GET /:id returns it). */
export const versionSchema = z.number().int().min(1).max(2_147_483_647);

/** POST /api/databases: a new database under a page, inline (in the page) or its own page. */
export const newDatabaseRequest = z.strictObject({
  parentId: pageIdSchema,
  inline: z.boolean(),
  title: lineSchema(LIMITS.title).optional(),
});
export type NewDatabaseRequest = z.infer<typeof newDatabaseRequest>;

/**
 * PATCH /api/databases/:id. `subItems: true` adds the "Parent item" and "Sub-items" relations;
 * false turns sub-items off and keeps the properties. `dependencies` with a shift adds "Blocked by"
 * and "Blocking" (or just changes the shift when they're on); null turns them off the same way.
 */
export const databaseSettingsRequest = z.strictObject({
  version: versionSchema,
  locked: z.boolean().optional(),
  defaultTemplateId: idSchema.nullable().optional(),
  rowPageLayout: rowPageLayoutSchema.nullable().optional(),
  subItems: z.boolean().optional(),
  dependencies: z
    .strictObject({ shift: z.enum(['shift', 'none']) })
    .nullable()
    .optional(),
  description: richTextSchema().optional(),
});
export type DatabaseSettingsRequest = z.infer<typeof databaseSettingsRequest>;

const property = propertySchema.shape;

/**
 * POST /api/databases/:id/properties: a new property (the server gives its id). A relation with
 * any twoWayPropertyId is two-way: the server adds the matching property on the target, named
 * `twoWayName` or after this database. `viewId` and `afterPropertyId` show it in that view after
 * that column ("Insert left or right"); otherwise it shows in table views.
 */
export const newPropertyRequest = z.strictObject({
  version: versionSchema,
  name: property.name,
  config: property.config,
  description: property.description.optional(),
  rowPage: property.rowPage.optional(),
  access: propertyAccessSchema.optional(),
  viewId: idSchema.optional(),
  afterPropertyId: idSchema.optional(),
  twoWayName: property.name.optional(),
});

/** PATCH /api/databases/:id/properties/:pid: the parts that change; a new config.type changes the type. */
export const propertyChangeRequest = z.strictObject({
  version: versionSchema,
  name: property.name.optional(),
  description: property.description.optional(),
  config: property.config.optional(),
  rowPage: property.rowPage.optional(),
  access: propertyAccessSchema.optional(),
});

/** Settings writes that need only the version: delete (also as ?version=), restore, duplicate. */
export const versionRequest = z.strictObject({ version: versionSchema });
