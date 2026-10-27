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
  rowTemplateSchema,
  viewSchema,
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
 * PATCH /api/databases/:id. `defaultTemplateId` is "Set as default for all views": the database's
 * default (null: an empty row), and views drop their own defaults. `subItems: true` adds the
 * "Parent item" and "Sub-items" relations; false turns sub-items off and keeps the properties.
 * `dependencies` with a shift adds "Blocked by" and "Blocking" (or just changes the shift when
 * they're on); null turns them off the same way.
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

const view = viewSchema.shape;

/**
 * POST /api/databases/:id/views: a new view with the defaults of its layout, after `afterViewId`
 * (or last), or a tile of the dashboard `dashboardId`.
 */
export const newViewRequest = z.strictObject({
  version: versionSchema,
  layout: view.layout,
  name: view.name.optional(),
  afterViewId: idSchema.optional(),
  dashboardId: idSchema.optional(),
});
export type NewViewRequest = z.infer<typeof newViewRequest>;

/**
 * PATCH /api/databases/:id/views/:vid: the view settings that change. Not its id, the dashboard it
 * belongs to or its manual row order (PUT /:id/views/:vid/order keeps that).
 */
export const viewChangeRequest = z
  .strictObject(view)
  .omit({ id: true, dashboardId: true, manualOrder: true })
  .partial()
  .extend({ version: versionSchema });
export type ViewChangeRequest = z.infer<typeof viewChangeRequest>;

/** PUT /api/databases/:id/views/order: every view tab's id once, in the new order. */
export const viewOrderRequest = z.strictObject({
  version: versionSchema,
  viewIds: z.array(idSchema).max(LIMITS.views),
});

const template = rowTemplateSchema.shape;

/**
 * POST /api/databases/:id/templates (a new template; without a name it's "New template", numbered
 * when taken) and PATCH /:id/templates/:tid (the parts that change). `values` holds every preset
 * the person can see (presets on properties they can't see stay as saved). A schedule runs as the
 * person who saves it: its ownerId is replaced, unless the schedule comes back unchanged.
 */
export const templateRequest = z.strictObject({
  version: versionSchema,
  name: template.name.optional(),
  icon: template.icon.optional(),
  values: template.values.optional(),
  repeat: template.repeat,
});
export type TemplateRequest = z.infer<typeof templateRequest>;
