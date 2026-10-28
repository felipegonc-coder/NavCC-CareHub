import { z } from 'zod';
import { IMPORT_LIMITS, PLAN_COLUMN_TYPES, type ImportProblem } from './plan';
import { IMPORT_SOURCE_IDS } from './sources';

// What the import routes take and give (/api/import-export/imports, docs/extras/import-export.md).

const flag = z.boolean().optional();
/** ImportOptions; only the source's own count (optionsFor). */
export const importOptionsSchema = z.strictObject({ asDatabase: flag, includeArchived: flag });

export const startImportSchema = z.strictObject({
  source: z.enum(IMPORT_SOURCE_IDS),
  fileName: z.string().trim().min(1).max(IMPORT_LIMITS.fileNameChars),
  size: z.number().int().min(1).max(IMPORT_LIMITS.uploadBytes),
  /** Where it goes: a page, or null for Private. */
  pageId: z.uuid().nullable(),
  /** True when the Import screen read the file itself and uploads its plan (see planUploadSchema). */
  planned: z.boolean().default(false),
  /** The source's options that the person ticked. */
  options: importOptionsSchema.optional(),
});
export type StartImportInput = z.infer<typeof startImportSchema>;

export const undoImportSchema = z.strictObject({
  /** "Remove them too": pages changed since the import go to Trash as well. */
  removeChanged: z.boolean().default(false),
});

const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const text = (max: number) => z.string().max(max);
const content = z.union([
  z.strictObject({ markdown: text(IMPORT_LIMITS.pageChars) }),
  /** Checked against the page schema on the server. */
  z.strictObject({ doc: z.looseObject({ type: z.literal('doc') }) }),
]);
const source = text(1_000);
/** PlanDates: a date, or a date and time with or without a zone. */
const when = z.union([z.iso.date(), z.iso.datetime({ offset: true, local: true })]).optional();

/**
 * `plan.json` in the zip the Import screen uploads for the sources it reads itself (HTML, Word,
 * Notion's HTML export, Evernote, Confluence): the plan, with each file as an entry of that zip.
 */
export const planUploadSchema = z.strictObject({
  pages: z
    .array(
      z.strictObject({
        key,
        parent: key.nullable(),
        title: text(IMPORT_LIMITS.titleChars),
        content,
        source,
        created: when,
        updated: when,
      }),
    )
    .max(IMPORT_LIMITS.pages),
  databases: z
    .array(
      z.strictObject({
        key,
        parent: key.nullable(),
        title: text(IMPORT_LIMITS.titleChars),
        columns: z
          .array(
            z.strictObject({
              name: text(IMPORT_LIMITS.columnNameChars),
              type: z.enum(PLAN_COLUMN_TYPES).nullable(),
            }),
          )
          .min(1)
          .max(IMPORT_LIMITS.columns),
        rows: z
          .array(
            z.strictObject({
              key,
              cells: z.array(text(IMPORT_LIMITS.cellChars)).max(IMPORT_LIMITS.columns),
              content: content.optional(),
              created: when,
              updated: when,
            }),
          )
          .max(IMPORT_LIMITS.rows),
        source,
        view: z
          .strictObject({
            layout: z.literal('board'),
            groupBy: text(IMPORT_LIMITS.columnNameChars),
          })
          .optional(),
      }),
    )
    .max(IMPORT_LIMITS.pages),
  files: z
    .array(
      z.strictObject({
        key,
        name: z.string().min(1).max(IMPORT_LIMITS.fileNameChars),
        entry: z.string().min(1).max(1_000),
      }),
    )
    .max(IMPORT_LIMITS.files),
  problems: z
    .array(z.strictObject({ file: source, what: text(200), why: text(1_000) }))
    .max(IMPORT_LIMITS.problems),
});

export type ImportStatus =
  'uploading' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled' | 'undone';

export interface ImportCounts {
  pages: number;
  databases: number;
  rows: number;
  files: number;
}

/** An import as its maker sees it (`GET /api/import-export/imports/:id`). */
export interface ImportView {
  id: string;
  source: string;
  fileName: string;
  size: number;
  status: ImportStatus;
  /** Where it went: the page, or Private. */
  destination: { pageId: string | null; title: string };
  /** While running: pages made so far, of how many. */
  progress: { done: number; total: number } | null;
  counts: ImportCounts | null;
  problems: ImportProblem[];
  problemCount: number;
  /** Why it stopped, safe to show: "The import stopped: the zip is damaged. Nothing was added." */
  error: string | null;
  /** The person can still undo it (done, less than 7 days ago). */
  canUndo: boolean;
  createdAt: string;
  finishedAt: string | null;
}

/** What Undo import will do: pages changed since the import first, then the rest. */
export interface UndoPreview {
  changed: { pageId: string; title: string }[];
  unchanged: { pageId: string; title: string }[];
}
