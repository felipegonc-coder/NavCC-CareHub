// The exports API (apps/server/src/features/import-export/export/routes.ts): start an export,
// follow it, and whether Export shows on a page.
import { z } from 'zod';
import { api } from '../../../lib/api';

export const EXPORTS_PATH = '/api/import-export/exports';

/** How often a running export is checked. */
export const EXPORT_POLL_MS = 2000;

export const exportViewSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  format: z.enum(['markdown', 'html']),
  status: z.enum(['running', 'ready', 'failed', 'expired']),
  progress: z.object({ done: z.number(), total: z.number().nullable() }),
  pageCount: z.number().nullable(),
  skippedCount: z.number().nullable(),
  fileName: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  expiresAt: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  error: z.string().nullable(),
});
export type ExportView = z.infer<typeof exportViewSchema>;

const exportResponse = z.object({ export: exportViewSchema });
const allowedResponse = z.object({ allowed: z.boolean() });

export interface StartExportBody {
  pageId: string;
  format: ExportView['format'];
  includeSubpages: boolean;
  includeFiles: boolean;
  databases: 'view' | 'all';
}

export async function startExport(body: StartExportBody): Promise<ExportView> {
  return (await api.post(EXPORTS_PATH, body, { schema: exportResponse })).export;
}

export async function fetchExport(exportId: string, signal?: AbortSignal): Promise<ExportView> {
  const path = `${EXPORTS_PATH}/${encodeURIComponent(exportId)}`;
  return (await api.get(path, { schema: exportResponse, signal })).export;
}

/** Whether they may export this page (IE-16): false hides Export from the page menu. */
export async function fetchExportAllowed(pageId: string, signal?: AbortSignal): Promise<boolean> {
  const path = `${EXPORTS_PATH}/allowed?pageId=${encodeURIComponent(pageId)}`;
  return (await api.get(path, { schema: allowedResponse, signal })).allowed;
}

/** How far a running export is, as a whole percentage. */
export function exportPercent(view: Pick<ExportView, 'progress'>): number {
  const { done, total } = view.progress;
  if (!total) return 0;
  return Math.min(100, Math.floor((done / total) * 100));
}

/** Starts the browser's download of a ready export: same origin, so the session goes with it. */
export function downloadExport(view: Pick<ExportView, 'downloadUrl' | 'fileName'>): boolean {
  if (!view.downloadUrl) return false;
  const link = document.createElement('a');
  link.href = view.downloadUrl;
  link.download = view.fileName ?? '';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  return true;
}

/** "2.4 MB", for the export's size. */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
