// What the Print view shows (apps/server/src/features/import-export/export/print.ts): the page, a
// row's properties, its blocks, the pages it points at, titled only if they can open them, and
// the inline databases they can open, as their view's rows.
import { parseCsv, unprotectCell } from '@carehub/databases/csv';
import { blocksOf } from '@carehub/extras/import-export/export/content';
import { z } from 'zod';
import { api } from '../../../lib/api';

export const PRINT_PATH = '/api/import-export/print';

const linkedPageSchema = z.object({ title: z.string(), icon: z.string().nullable() });
export type PrintLinkedPage = z.infer<typeof linkedPageSchema>;

// An inline database comes as its view's CSV; printed, it's a table: the header row, then a row
// each. The apostrophe that keeps spreadsheets from running "=..." as a formula isn't shown.
const databaseSchema = z
  .object({ databaseId: z.string(), viewId: z.string().nullable(), csv: z.string() })
  .transform(({ databaseId, viewId, csv }) => ({
    databaseId,
    viewId,
    rows: parseCsv(csv, ',').map((row) => row.map(unprotectCell)),
  }));
export type PrintDatabase = z.output<typeof databaseSchema>;

export const printViewSchema = z.object({
  page: z.object({ title: z.string(), icon: z.string().nullable() }),
  properties: z.array(z.object({ name: z.string(), value: z.string() })),
  // Read without trusting their shape, as the exporters do: a block that isn't one is dropped.
  blocks: z.array(z.unknown()).transform((blocks) => blocksOf(blocks)),
  pages: z.record(z.string(), linkedPageSchema.nullable()),
  databases: z.array(databaseSchema).default([]),
});
export type PrintView = z.output<typeof printViewSchema>;

export async function fetchPrintView(pageId: string, signal?: AbortSignal): Promise<PrintView> {
  const path = `${PRINT_PATH}/${encodeURIComponent(pageId)}`;
  return api.get(path, { schema: printViewSchema, signal });
}
