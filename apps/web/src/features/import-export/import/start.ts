import {
  ImportFileError,
  stoppedMessage,
  type ImportSource,
  type ImportView,
} from '@carehub/extras/import-export/import/index';
import { ApiError } from '../../../lib/api';
import { importsApi } from './client';
import { fileProblem, prepareUpload, uploadName, type PrepareOptions } from './prepare';

// What Import does (Import and export spec, section 2): check the file, read it here when the
// screen reads its source, start the import and send the file. The import then runs on the
// server, and the progress panel follows it.

export interface StartRequest {
  source: ImportSource;
  file: File;
  /** Where it goes: a page, or null for Private. */
  pageId: string | null;
}

/** The import, waiting in line; or what to tell the person, with nothing added. */
export type StartResult = { ok: true; import: ImportView } | { ok: false; message: string };

/** What the server's refusals mean here; its own message when it gives one. */
function refusal(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  if (error.code === 'forbidden') return "You can't add pages there.";
  if (error.code === 'not_found') return "That page isn't there anymore. Pick another place.";
  return error.message;
}

export async function startImport(
  { source, file, pageId }: StartRequest,
  options?: PrepareOptions,
): Promise<StartResult> {
  const problem = fileProblem(source, file);
  if (problem) return { ok: false, message: problem };
  let upload;
  try {
    upload = await prepareUpload(source, file, options);
  } catch (error) {
    const reason = error instanceof ImportFileError ? error.message : "the file couldn't be read";
    return { ok: false, message: stoppedMessage(reason) };
  }
  let started: ImportView;
  try {
    started = await importsApi.start({
      source: source.id,
      fileName: uploadName(file.name),
      size: file.size,
      pageId,
      planned: upload.planned,
    });
  } catch (error) {
    return { ok: false, message: refusal(error) };
  }
  try {
    return { ok: true, import: await importsApi.send(started.id, upload.body) };
  } catch (error) {
    // An import left waiting for its file would count against the person's open imports.
    await importsApi.cancel(started.id).catch(() => undefined);
    return { ok: false, message: refusal(error) };
  }
}
