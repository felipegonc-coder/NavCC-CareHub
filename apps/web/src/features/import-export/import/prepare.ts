import { decodeCsvBytes } from '@carehub/databases/csv';
import { ZIP_LIMITS } from '@carehub/databases/xlsx';
import {
  IMPORT_LIMITS,
  ImportFileError,
  acceptsFileName,
  checkPlan,
  type ImportOptions,
  type ImportPlan,
  type ImportProblem,
  type ImportSource,
  type ImportSourceId,
  type ImportZip,
  type Importer,
} from '@carehub/extras/import-export/import/index';
import { BROWSER_IMPORTERS } from './importers';
import { inflateRaw, openZip, zipParts, type Inflate, type ZipItem } from './zip';

// Getting a picked file ready to send (Import and export spec, sections 2 and 3.1): the checks the
// screen makes first, and, for the sources it reads itself, the plan it uploads instead of the
// file (docs/extras/import-export.md). The server checks everything again.

/** "Too big" (the upload limit, which is lower than the spec's 2 GB for now). */
export const TOO_BIG = 'Imports can be up to 100 MB.';

/** What stops this file before anything is sent ("File not accepted", "Too big"), or null. */
export function fileProblem(source: ImportSource, file: { name: string; size: number }) {
  if (!acceptsFileName(source, file.name)) return source.notAccepted;
  if (file.size > IMPORT_LIMITS.uploadBytes) return TOO_BIG;
  if (file.size === 0) return 'The file is empty.';
  return null;
}

/** The file's name as the import keeps it: at most 255 characters, keeping its ending. */
export function uploadName(name: string): string {
  const trimmed = name.trim();
  const max = IMPORT_LIMITS.fileNameChars;
  if (trimmed.length <= max) return trimmed;
  const ending = /\.[A-Za-z0-9]{1,9}$/.exec(trimmed)?.[0] ?? '';
  const start = trimmed.slice(0, max - ending.length);
  // Never half of an emoji.
  return `${/[\uD800-\uDBFF]$/.test(start) ? start.slice(0, -1) : start}${ending}`;
}

/** What the screen sends: the file as it is, or the zip of the plan it read here (planned). */
export interface Upload {
  planned: boolean;
  body: Blob;
}

export interface PrepareOptions {
  importers?: Partial<Record<ImportSourceId, Importer>>;
  inflate?: Inflate;
  /** The source's options that the person ticked, for its importer. */
  options?: ImportOptions;
}

/** Plan files can be this big; the server's zip reader refuses a zip with a bigger entry. */
const FILE_MAX = ZIP_LIMITS.entryBytes;

function readBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new ImportFileError("the file couldn't be read"));
    reader.readAsArrayBuffer(file);
  });
}

/** plan.json: only what the upload's schema takes (planUploadSchema), field by field. */
function planJson(plan: ImportPlan, files: { key: string; name: string; entry: string }[]) {
  const problems: ImportProblem[] = plan.problems.map(({ file, what, why }) => ({
    file,
    what,
    why,
  }));
  return JSON.stringify({
    pages: plan.pages.map(({ key, parent, title, content, source }) => ({
      key,
      parent,
      title,
      content,
      source,
    })),
    databases: plan.databases.map(({ key, parent, title, columns, rows, source }) => ({
      key,
      parent,
      title,
      columns: columns.map(({ name, type }) => ({ name, type })),
      rows: rows.map(({ key: row, cells, content }) =>
        content ? { key: row, cells, content } : { key: row, cells },
      ),
      source,
    })),
    files,
    // The summary keeps the first 1,000 (IMPORT_LIMITS.problems).
    problems: problems.slice(0, IMPORT_LIMITS.problems),
  });
}

/**
 * The upload for a plan: plan.json, then each file as `files/<key>`. A file that isn't in the
 * picked zip is left out of the upload but kept in the plan, so the server lists it as skipped.
 */
async function planUpload(plan: ImportPlan, zip: ImportZip | null): Promise<Blob> {
  const items: ZipItem[] = [];
  const files: { key: string; name: string; entry: string }[] = [];
  const problems = [...plan.problems];
  for (const file of plan.files) {
    const bytes =
      file.bytes ??
      (file.entry && zip?.names.includes(file.entry) ? await zip.read(file.entry) : null);
    if (bytes && bytes.byteLength > FILE_MAX) {
      problems.push({ file: file.name, what: 'Skipped', why: 'Files inside can be up to 50 MB.' });
      continue;
    }
    const entry = `files/${file.key}`;
    files.push({ key: file.key, name: file.name, entry });
    if (bytes) items.push({ name: entry, bytes });
  }
  if (items.length + 1 > ZIP_LIMITS.entries) {
    throw new ImportFileError(
      `it has more than ${(ZIP_LIMITS.entries - 1).toLocaleString('en-US')} files`,
    );
  }
  const json = new TextEncoder().encode(planJson({ ...plan, problems }, files));
  const parts = zipParts([{ name: 'plan.json', bytes: json }, ...items]);
  const body = new Blob(parts as BlobPart[], { type: 'application/octet-stream' });
  if (body.size > IMPORT_LIMITS.uploadBytes) {
    throw new ImportFileError('its pages and files come to more than 100 MB');
  }
  return body;
}

/**
 * Reads the file here when the screen has an importer for its source, and gives what to send.
 * Throws ImportFileError when the file can't be read, before anything is sent; the screen shows
 * stoppedMessage for it. A Notion export is read on the server until there's an importer here
 * for its HTML kind (then readsInBrowser picks).
 */
export async function prepareUpload(
  source: ImportSource,
  file: File,
  { importers = BROWSER_IMPORTERS, inflate = inflateRaw, options = {} }: PrepareOptions = {},
): Promise<Upload> {
  const importer = importers[source.id];
  if (!importer) return { planned: false, body: file };
  const bytes = await readBytes(file);
  const zip = /\.(?:zip|docx)$/i.test(file.name) ? openZip(bytes, inflate) : null;
  const plan = await importer.plan({
    fileName: file.name,
    bytes,
    text: async () => decodeCsvBytes(bytes),
    zip,
    options,
  });
  checkPlan(plan);
  return { planned: true, body: await planUpload(plan, zip) };
}
