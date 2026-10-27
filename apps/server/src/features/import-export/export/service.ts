// Export requests (Import and export spec, sections 3.3 and 5): who may export, small exports at
// once, bigger ones as a background job with a 🔔 notice, and downloads for their maker only, for
// 7 days. Every export goes to the Security log.
import { atLeast } from '@carehub/shared';
import { and, count, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { httpError } from '../../../core/errors';
import type { Db } from '../../../db';
import { JobError, scheduleJob, type JobContext } from '../../jobs';
import { sendNotice } from '../../notices';
import { buildExport, planExport, type BuiltExport } from './build';
import { ieExports, type ExportFormat, type ExportOptions, type ExportStatus } from './schema';
import { exportSources } from './sources';
import { ExportTooLargeError } from './zip';

export const EXPORT_JOB = 'import-export.export';
const MB = 1024 * 1024;
/** Exports up to 50 pages and 100 MB download at once. */
export const AT_ONCE = { pages: 50, bytes: 100 * MB };
/** The most any export holds: the zip waits in Postgres until Files can keep it. */
export const MAX_EXPORT_BYTES = 500 * MB;
const DAY_MS = 24 * 60 * 60 * 1000;
export const LINK_DAYS = 7;
const RUNNING_LIMIT = 3;

const columns = {
  id: ieExports.id,
  workspaceId: ieExports.workspaceId,
  pageId: ieExports.pageId,
  createdBy: ieExports.createdBy,
  format: ieExports.format,
  options: ieExports.options,
  status: ieExports.status,
  progressDone: ieExports.progressDone,
  progressTotal: ieExports.progressTotal,
  pageCount: ieExports.pageCount,
  skippedCount: ieExports.skippedCount,
  fileName: ieExports.fileName,
  sizeBytes: ieExports.sizeBytes,
  error: ieExports.error,
  expiresAt: ieExports.expiresAt,
};
interface ExportRecord {
  id: string;
  workspaceId: string;
  pageId: string;
  createdBy: string;
  format: ExportFormat;
  options: ExportOptions;
  status: ExportStatus;
  progressDone: number;
  progressTotal: number | null;
  pageCount: number | null;
  skippedCount: number | null;
  fileName: string | null;
  sizeBytes: number | null;
  error: string | null;
  expiresAt: Date | null;
}

/** An export as its maker sees it (`GET /api/import-export/exports/:id`). */
export interface ExportView {
  id: string;
  pageId: string;
  format: ExportFormat;
  status: ExportStatus;
  progress: { done: number; total: number | null };
  pageCount: number | null;
  skippedCount: number | null;
  fileName: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  /** Works only for the maker, until `expiresAt`. */
  downloadUrl: string | null;
  error: string | null;
}

function toView(row: ExportRecord, now = new Date()): ExportView {
  const expired = row.expiresAt !== null && row.expiresAt <= now;
  const status = row.status === 'ready' && expired ? 'expired' : row.status;
  return {
    id: row.id,
    pageId: row.pageId,
    format: row.format,
    status,
    progress: { done: row.progressDone, total: row.progressTotal },
    pageCount: row.pageCount,
    skippedCount: row.skippedCount,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    downloadUrl: status === 'ready' ? `/api/import-export/exports/${row.id}/download` : null,
    error: row.error,
  };
}

/** Members can export unless an Admin turned it off; Admins always can (IE-16). */
export async function canExport(db: Db, userId: string, workspaceId: string): Promise<boolean> {
  const sources = exportSources();
  if ((await sources.membersCanExport(db, workspaceId)) !== false) return true;
  return sources.isAdmin(db, workspaceId, userId);
}

/** The page if they can view it: 404 when it's missing or in Trash, 403 below Can view. */
export async function viewablePage(db: Db, userId: string, pageId: string) {
  const sources = exportSources();
  const page = (await sources.pages(db, [pageId])).get(pageId);
  if (!page) throw httpError(404, 'not_found');
  const level = (await sources.access(db, userId, [pageId])).get(pageId) ?? 'none';
  if (!atLeast(level, 'view')) throw httpError(403, 'forbidden');
  return page;
}

async function finish(db: Db, row: ExportRecord, built: BuiltExport, by: string) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(ieExports)
      .set({
        status: 'ready',
        file: built.zip,
        fileName: built.fileName,
        sizeBytes: built.zip.length,
        pageCount: built.pageCount,
        progressDone: built.pageCount,
        progressTotal: built.pageCount,
        finishedAt: now,
        expiresAt: new Date(now.getTime() + LINK_DAYS * DAY_MS),
      })
      .where(eq(ieExports.id, row.id));
    // Who, what, format, size and when (IE-17).
    await exportSources().logSecurityEvent(tx, {
      workspaceId: row.workspaceId,
      actorId: by,
      action: 'export.created',
      targetId: row.pageId,
      details: {
        exportId: row.id,
        format: row.format,
        pages: built.pageCount,
        sizeBytes: built.zip.length,
      },
    });
  });
}

async function fail(db: Db, exportId: string, error: string) {
  await db
    .update(ieExports)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(and(eq(ieExports.id, exportId), eq(ieExports.status, 'running')));
}

async function record(db: Db, exportId: string): Promise<ExportRecord | undefined> {
  const [row] = await db.select(columns).from(ieExports).where(eq(ieExports.id, exportId));
  return row;
}

export interface StartExportInput extends ExportOptions {
  pageId: string;
  format: ExportFormat;
}

/** Starts an export: small ones are ready when this returns; bigger ones run in the background. */
export async function startExport(db: Db, userId: string, input: StartExportInput) {
  const page = await viewablePage(db, userId, input.pageId);
  if (!(await canExport(db, userId, page.workspaceId))) throw httpError(403, 'forbidden');
  const [running] = await db
    .select({ n: count() })
    .from(ieExports)
    .where(and(eq(ieExports.createdBy, userId), eq(ieExports.status, 'running')));
  if ((running?.n ?? 0) >= RUNNING_LIMIT) {
    throw httpError(429, 'rate_limited', 'Wait for your other exports to finish, then try again.');
  }
  const { pageId, format, ...options } = input;
  const plan = await planExport(db, userId, page, options);
  const [created] = await db
    .insert(ieExports)
    .values({
      workspaceId: page.workspaceId,
      pageId,
      createdBy: userId,
      format,
      options,
      progressTotal: plan.pages.length,
      pageCount: plan.pages.length,
      skippedCount: plan.skipped,
    })
    .returning(columns);
  if (!created) throw new Error('The export was not saved.');
  const row: ExportRecord = created;
  if (plan.pages.length <= AT_ONCE.pages) {
    try {
      const built = await buildExport(db, userId, plan, {
        format,
        options,
        maxBytes: AT_ONCE.bytes,
      });
      await finish(db, row, built, userId);
      return getExport(db, userId, row.id);
    } catch (error) {
      // Over 100 MB: it carries on in the background, with the bigger limit.
      if (!(error instanceof ExportTooLargeError)) {
        await fail(db, row.id, 'Something went wrong.');
        throw error;
      }
    }
  }
  const { jobId } = await scheduleJob({
    kind: EXPORT_JOB,
    payload: { exportId: row.id },
    key: row.id,
    workspaceId: page.workspaceId,
    ownerUserId: userId,
  });
  await db.update(ieExports).set({ jobId }).where(eq(ieExports.id, row.id));
  return getExport(db, userId, row.id);
}

async function notifyReady(row: ExportRecord) {
  try {
    await sendNotice({
      workspaceId: row.workspaceId,
      userId: row.createdBy,
      kind: 'alert',
      sender: 'Export',
      icon: '📦',
      title: 'Your export is ready',
      text: `The download link works only for you, for ${LINK_DAYS} days.`,
      card: { type: 'page', pageId: row.pageId },
      buttons: [{ label: 'Download', href: `/exports/${row.id}` }],
    });
  } catch {
    // Notices aren't running until their routes are registered; the export page has the link.
  }
}

/** The background job for exports over 50 pages or 100 MB (IE-15). */
export async function runExportJob(db: Db, exportId: string, ctx: JobContext) {
  const row = await record(db, exportId);
  if (!row || row.status !== 'running') return;
  const sources = exportSources();
  // Access is checked again: it may have changed since the export was asked for.
  const page = (await sources.pages(db, [row.pageId])).get(row.pageId);
  const level = (await sources.access(db, row.createdBy, [row.pageId])).get(row.pageId);
  if (
    !page ||
    !atLeast(level ?? 'none', 'view') ||
    !(await canExport(db, row.createdBy, page.workspaceId))
  ) {
    await fail(db, row.id, "You can't export this page any more.");
    return;
  }
  const plan = await planExport(db, row.createdBy, page, row.options);
  let saved = 0;
  try {
    const built = await buildExport(db, row.createdBy, plan, {
      format: row.format,
      options: row.options,
      maxBytes: MAX_EXPORT_BYTES,
      signal: ctx.signal,
      onProgress: async (done, total) => {
        ctx.setProgress({ done, total, label: 'Preparing your export' });
        if (done - saved < 25 && done !== total) return;
        saved = done;
        await db
          .update(ieExports)
          .set({ progressDone: done, progressTotal: total })
          .where(eq(ieExports.id, row.id));
      },
    });
    await finish(db, row, built, row.createdBy);
  } catch (error) {
    if (!(error instanceof ExportTooLargeError)) throw error;
    const message = `Exports can be up to ${MAX_EXPORT_BYTES / MB} MB. Try fewer pages, or leave out files.`;
    await fail(db, row.id, message);
    throw new JobError(message);
  }
  await notifyReady(row);
}

/** After the job's last try fails. */
export async function failExportJob(db: Db, exportId: string) {
  await fail(db, exportId, 'Something went wrong. Try exporting again.');
}

async function mine(db: Db, userId: string, exportId: string): Promise<ExportRecord> {
  const row = await record(db, exportId);
  if (!row) throw httpError(404, 'not_found');
  // Only its maker: the link works for nobody else (IE-15).
  if (row.createdBy !== userId) throw httpError(403, 'forbidden');
  return row;
}

export async function getExport(db: Db, userId: string, exportId: string): Promise<ExportView> {
  return toView(await mine(db, userId, exportId));
}

/** The zip, for its maker, until the link expires. */
export async function downloadExport(db: Db, userId: string, exportId: string) {
  const view = toView(await mine(db, userId, exportId));
  if (view.status === 'expired') {
    throw httpError(410, 'not_found', 'This download link has expired. Export the page again.');
  }
  if (view.status !== 'ready') throw httpError(409, 'conflict', "This export isn't ready.");
  const [row] = await db
    .update(ieExports)
    .set({ downloadedAt: new Date(), downloadCount: sql`${ieExports.downloadCount} + 1` })
    .where(and(eq(ieExports.id, exportId), isNotNull(ieExports.file)))
    .returning({ file: ieExports.file, fileName: ieExports.fileName });
  if (!row?.file)
    throw httpError(410, 'not_found', 'This download link has expired. Export the page again.');
  return { file: row.file, fileName: row.fileName ?? 'Export.zip' };
}

/** Deletes the files of expired exports (a periodic task). */
export async function expireExports(db: Db, now = new Date()): Promise<number> {
  const expired = await db
    .update(ieExports)
    .set({ status: 'expired', file: null })
    .where(and(isNotNull(ieExports.file), lte(ieExports.expiresAt, now)))
    .returning({ id: ieExports.id });
  return expired.length;
}
