// Request bodies for the row routes (decision 0200), built from the package's schemas. Parse them
// with parseRequest from '@carehub/databases/schemas' like every other body; values are checked
// against their properties afterwards (validateValue), by rows.ts.
import { LIMITS } from '@carehub/databases';
import { idSchema, lineSchema, valuesSchema } from '@carehub/databases/schemas';
import { z } from 'zod';
import { pageIdSchema } from './requests';

/** Rows one request may change, move to Trash or restore. */
export const MAX_ROWS_PER_REQUEST = 500;

const rowIdsSchema = z.array(pageIdSchema).min(1).max(MAX_ROWS_PER_REQUEST);

/**
 * POST /:id/rows. `templateId` null starts an empty row; left out, the view's or database's default
 * template applies. `viewId` adds the view's filter prefill and, with `groupKey`, the group's value.
 */
export const newRowRequest = z.strictObject({
  title: lineSchema(LIMITS.title).optional(),
  values: valuesSchema.optional(),
  templateId: idSchema.nullable().optional(),
  viewId: idSchema.optional(),
  groupKey: z.string().max(LIMITS.text).optional(),
  afterRowId: pageIdSchema.optional(),
});
export type NewRowRequest = z.infer<typeof newRowRequest>;

/** PATCH /:id/rows/:rowId: the changed properties only. */
export const rowValuesRequest = z.strictObject({ values: valuesSchema });

/** POST /:id/rows/bulk: the same values on every row. */
export const bulkValuesRequest = z.strictObject({ rowIds: rowIdsSchema, values: valuesSchema });

/** POST /:id/rows/trash and POST /:id/rows/restore. */
export const rowIdsRequest = z.strictObject({ rowIds: rowIdsSchema });
